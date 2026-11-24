"""Audit of the exported library: public/audio/sfx/manifest.json and every WAV it lists.

Skipped until `python3 scripts/audio/sfx/build.py --export` has run."""

import json
import math
import re
import unittest

import numpy as np

from audiolib import io, paths
from sfxlib import manifest as man
from sfxlib.core import FRAME, PEAK_DBFS, ROLES, TRUE_PEAK_CAP_DBTP, phone_loss_limit

PUBLIC = paths.PUBLIC_AUDIO / "sfx" / "manifest.json"
REQUIRED_GROUPS = {
    "whoosh_short", "whoosh_medium", "whoosh_long", "whoosh_reverse", "pop", "pop_rise", "plop", "tick", "swipe",
    "key", "key_space", "key_enter", "typing_burst", "typing_loop", "mouse_click", "mouse_double",
    "ding", "success", "error", "developing_pulse", "developing_loop", "rekt_needle", "rekt_alarm",
    "mug", "chair_creak", "badger_paw", "badger_tail",
}
VOCAL_WORDS = re.compile(r"\b(bark|barks|growl|whine|whimper|howl|yelp|woof|vocal|voice)\b", re.I)


@unittest.skipUnless(PUBLIC.exists(), "run scripts/audio/sfx/build.py --export first")
class Library(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = json.loads(PUBLIC.read_text())

    def test_schema_and_groups(self):
        self.assertEqual(man.validate(self.m), [])
        self.assertEqual(self.m["frameSamples"], FRAME)
        groups = set(self.m["groups"])
        self.assertTrue(REQUIRED_GROUPS <= groups, REQUIRED_GROUPS - groups)
        for g, info in self.m["groups"].items():
            self.assertGreaterEqual(len(info["ids"]), 3, g)

    def test_every_file_matches_its_entry(self):
        for e in self.m["sounds"]:
            path = paths.STUDIO / "public" / e["file"]
            self.assertTrue(path.exists(), e["id"])
            self.assertEqual(man.sha256_file(path), e["sha256"], e["id"])
            info = io.info(path)
            self.assertEqual((info["samplerate"], info["channels"], info["subtype"]), (48000, 2, "PCM_24"), e["id"])
            self.assertAlmostEqual(info["frames"] / 48.0, e["durationMs"], delta=0.06, msg=e["id"])
            self.assertLess(path.stat().st_size, 10 * 1024 * 1024, e["id"])
            a = io.read(path)
            pk = 20 * math.log10(float(np.max(np.abs(a))))
            self.assertAlmostEqual(pk, PEAK_DBFS, delta=0.05, msg=e["id"])
            self.assertEqual(int(np.sum(np.abs(a) >= 0.9999)), 0, e["id"])
            self.assertLess(float(np.max(np.abs(a.mean(axis=1)))), 1e-4, e["id"])
            if not e["loop"]:
                self.assertEqual(float(np.max(np.abs(a[:, -1]))), 0.0, e["id"])

    def test_sync_points_and_events_are_on_frames(self):
        for e in self.m["sounds"]:
            self.assertEqual(int(round(e["syncMs"] * 48)) % FRAME, 0, e["id"])
            self.assertEqual(e["syncFrame30"], int(round(e["syncMs"] * 30 / 1000)))
            if e["syncKind"] == "transient":
                self.assertLessEqual(e["transientMs"], 5.0, e["id"])
            for ev in e["events"]:
                self.assertEqual(int(round(ev["ms"] * 48)) % FRAME, 0, f"{e['id']} {ev}")
                self.assertLess(ev["ms"], e["durationMs"], e["id"])

    def test_gain_and_roles(self):
        for e in self.m["sounds"]:
            lo = e["loudness"]
            target = ROLES[e["role"]]["targetLufs"]
            after_tp = lo["truePeakDbtp"] + e["suggestedGainDb"]
            self.assertLessEqual(after_tp, TRUE_PEAK_CAP_DBTP + 0.06, e["id"])  # never louder than -6 dBTP
            if lo["gainCapped"]:
                self.assertLess(lo["lufs200Max"] + e["suggestedGainDb"], target, e["id"])
            else:
                self.assertAlmostEqual(lo["lufs200Max"] + e["suggestedGainDb"], target, delta=0.06, msg=e["id"])
            self.assertAlmostEqual(e["suggestedVolume"], 10 ** (e["suggestedGainDb"] / 20), delta=1e-3)
            self.assertLessEqual(lo["truePeakDbtp"], -1.0, e["id"])
            # the 200 ms basis sits between the EBU momentary (400 ms) and a 100 ms reading
            self.assertLessEqual(lo["lufsMomentaryMax"], lo["lufs200Max"] + 0.01, e["id"])
            self.assertLessEqual(lo["lufs200Max"], lo["lufs100Max"] + 0.01, e["id"])

    def test_phone_translation_and_pitch_groups(self):
        """Critic round 1: alerts must not vanish on a phone speaker; random groups keep one pitch."""
        by_group = {}
        for e in self.m["sounds"]:
            lim = phone_loss_limit(e["group"], e["role"])
            if lim is not None:
                self.assertGreaterEqual(e["loudness"]["phoneLossDb"], lim, e["id"])
            self.assertEqual(e["underSpeechTrimDb"], ROLES[e["role"]].get("underSpeechTrimDb", 0.0), e["id"])
            by_group.setdefault(e["group"], []).append(e)
        for g in ("pop", "plop"):
            self.assertEqual(len({e["pitch"] for e in by_group[g]}), 1, g)
        self.assertEqual([e["pitch"] for e in sorted(by_group["pop_rise"], key=lambda e: e["id"])], ["D5", "G5", "A5", "D6"])

    def test_sources_are_permissive_and_there_is_no_dog_voice(self):
        for e in self.m["sounds"]:
            for s in e["sources"]:
                self.assertIn(s["licence"], ("original work, owned", "CC0-1.0"), e["id"])
            if e["category"] == "badger":
                self.assertIsNone(VOCAL_WORDS.search(" ".join(e["tags"]) + " " + e["description"]), e["id"])

    def test_rig_synced_bursts_hit_strike_frames(self):
        from sfxlib import rig

        for e in self.m["sounds"]:
            if not e.get("rig"):
                continue
            phase = e["rig"]["startRigFrameMod36"]
            for ev in e["events"]:
                self.assertTrue(rig.is_strike(ev["frame"], phase), f"{e['id']} frame {ev['frame']}")


if __name__ == "__main__":
    unittest.main()


SYNC_RENDER = paths.OUT / "sfx" / "sync" / "sync_check.wav"


@unittest.skipUnless(PUBLIC.exists() and SYNC_RENDER.exists(), "run scripts/audio/sfx/sync_check.py first (renders through Remotion)")
class RemotionSync(unittest.TestCase):
    """The last Remotion render of SfxSyncCheck: every file placed exactly where startFrame() puts it."""

    def test_every_sound_lands_on_its_frame(self):
        import importlib.util

        spec = importlib.util.spec_from_file_location("sync_check", paths.AUDIO_DIR / "sfx" / "sync_check.py")
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        res = mod.check(SYNC_RENDER)
        self.assertGreaterEqual(len(res["rows"]), 8)
        for r in res["rows"]:
            self.assertLessEqual(abs(r["placementErrorSamples"]), 48, r)
            self.assertTrue(-1.0 <= r["syncErrorMs"] <= 5.0, r)
