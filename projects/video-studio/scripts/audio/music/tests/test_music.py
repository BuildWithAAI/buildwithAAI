"""Tests for the music package (scripts/audio/music): motif, notation, spec, loop folding, audits,
the cue registry and the delivered files.

    .venv-audio/bin/python -m unittest discover -s scripts/audio/music/tests -t scripts/audio/music

Score-level tests build every cue's score (no audio). Tests that need VCSL samples or delivered
files skip cleanly when those are absent.
"""

from __future__ import annotations

import json
import math
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
MUSIC = HERE.parent
sys.path.insert(0, str(MUSIC.parent))  # scripts/audio
sys.path.insert(0, str(MUSIC))

import numpy as np  # noqa: E402

from audiolib import analysis, paths  # noqa: E402
from audiolib.core import SR  # noqa: E402
from audiolib.midi import Score  # noqa: E402
from composer import audit, motif, notation, render, spec  # noqa: E402

VCSL_OK = paths.VCSL.exists()
PUBLIC = paths.PUBLIC_AUDIO / "music"


class MotifTests(unittest.TestCase):
    def test_minor_and_major_fingerprints(self):
        mn = [n.pitch for n in motif.notes("D4", "minor")]
        mj = [n.pitch for n in motif.notes("D4", "major")]
        self.assertEqual(mn, [62, 62, 69, 68, 65])  # D D A Ab F
        self.assertEqual(mj, [62, 62, 69, 68, 66])  # D D A G# F#
        ivs = lambda p: tuple(b - a for a, b in zip(p, p[1:]))  # noqa: E731
        self.assertEqual(ivs(mn), motif.INTERVALS[("full", "minor")])
        self.assertEqual(ivs(mj), motif.INTERVALS[("full", "major")])

    def test_rhythm_is_the_show_name(self):
        ns = motif.notes("D4")
        self.assertEqual([n.onset for n in ns], [0.0, 0.75, 1.0, 1.5, 2.0])
        self.assertEqual(motif.length_beats("full"), 4.0)
        self.assertEqual([n.onset for n in motif.notes("D4", stretch=2.0)], [0.0, 1.5, 2.0, 3.0, 4.0])

    def test_forms(self):
        self.assertEqual([n.pitch for n in motif.notes("D4", form="head")], [62, 62, 69])
        self.assertEqual([n.pitch for n in motif.notes("D4", form="tail")], [69, 68, 65])
        retro = motif.notes("D4", form="retro")
        self.assertEqual([n.pitch for n in retro], [65, 68, 69, 62, 62])
        self.assertEqual(retro[0].onset, 0.0)
        with self.assertRaises(ValueError):
            motif.notes("D4", form="sideways")

    def test_place_tags_and_statements_survive_humanising(self):
        s = Score(bpm=100)
        p = s.part("lead")
        motif.place(p, 4.0, "D4", octaves=(0, 12))
        motif.place(p, 8.0, "G3", mode="major", form="head")
        motif.place_badger(p, 12.0, "D2")
        render.humanize_part(p, s, timing_ms=8, seed="t")
        st = motif.statements(s)
        self.assertEqual(len(st), 2)
        self.assertTrue(all(x["ok"] for x in st))
        self.assertEqual(st[0]["pitches"], [62, 62, 69, 68, 65])  # the octave copy is not mixed in
        bad = motif.statements(s, "badger")
        self.assertEqual(len(bad), 1)
        self.assertEqual(bad[0]["pitches"], [39, 38])  # Eb2 then D2
        self.assertTrue(bad[0]["ok"])

    def test_rhythm_override_keeps_pitches(self):
        s = Score(bpm=100)
        p = s.part("x")
        motif.place(p, 0.0, "D5", form="retro", rhythm=[(0, .5), (.5, .5), (1, .5), (1.5, .5), (2, 2)])
        self.assertEqual([n.start for n in p.notes], [0, .5, 1, 1.5, 2])
        self.assertTrue(motif.statements(s)[0]["ok"])
        with self.assertRaises(ValueError):
            motif.place(p, 0.0, "D5", rhythm=[(0, 1)])

    def test_a_wrong_note_fails_the_fingerprint(self):
        s = Score(bpm=100)
        p = s.part("x")
        motif.place(p, 0.0, "D4")
        p.notes[3].pitch += 1  # the blue note "corrected" to A: no longer the motif
        self.assertFalse(motif.statements(s)[0]["ok"])


class NotationTests(unittest.TestCase):
    def test_line_durations_velocities_chords_rests(self):
        s = Score(bpm=120)
        p = s.part("p")
        end = notation.line(p, 2.0, "D4:.75 D4:.25@-14 r:1 [F3,A3]:1/2@100 C5:1~", vel=80, staccato=0.9)
        self.assertAlmostEqual(end, 5.5)
        self.assertEqual([n.pitch for n in p.notes], [62, 62, 53, 57, 72])
        self.assertEqual(p.notes[1].vel, 66)
        self.assertEqual(p.notes[2].vel, 100)
        self.assertAlmostEqual(p.notes[2].start, 4.0)
        self.assertAlmostEqual(p.notes[0].dur, 0.75 * 0.9)
        self.assertAlmostEqual(p.notes[-1].dur, 1.0)  # legato keeps the full slot
        self.assertAlmostEqual(notation.length_of("D4:1 r:1/2 E4:.5"), 2.0)
        for bad in ("D4", "D4:0", "[D4,F4:1", "Q4:1"):
            with self.assertRaises(ValueError):
                notation.tokens(bad)

    def test_grid(self):
        s = Score(bpm=120)
        p = s.part("kit")
        end = notation.grid(p, 4.0, {"k": "X...x.o.|........"}, {"k": 36})
        self.assertAlmostEqual(end, 8.0)
        self.assertEqual([(n.start, n.vel) for n in p.notes], [(4.0, 112), (5.0, 92), (5.5, 52)])
        with self.assertRaises(ValueError):
            notation.grid(p, 0.0, {"k": "Z"}, {"k": 36})


class SpecTests(unittest.TestCase):
    def test_delivery_format_threshold(self):
        frames_fit = (spec.MAX_BYTES - 44) // 6
        self.assertEqual(spec.delivery_format(frames_fit), "wav24")
        self.assertEqual(spec.delivery_format(frames_fit + 1), "flac")
        self.assertEqual(spec.delivery_format(20 * SR), "wav24")  # the 20 s end screen
        self.assertEqual(spec.delivery_format(64 * SR), "flac")  # a 64 s bed

    def test_frames_per_beat(self):
        for bpm, fpb in ((100, 18), (90, 20), (75, 24), (120, 15)):
            self.assertAlmostEqual(spec.frames_per_beat(bpm), fpb)

    def test_cue_validation(self):
        with self.assertRaises(ValueError):
            spec.Cue("x", "X", "zoora-ai", "bed", "m", "D", 90, "sting", lambda: None, loop=True)
        with self.assertRaises(ValueError):
            spec.Cue("x", "X", "nowhere", "bed", "m", "D", 90, "bed", lambda: None)
        with self.assertRaises(ValueError):
            spec.Cue("x", "X", "zoora-ai", "bed", "m", "D", 90, "bed")

    def test_manifest_merges(self):
        import tempfile

        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "manifest.json"
            spec.write_manifest(p, {"b": {"id": "b", "v": 1}})
            doc = spec.write_manifest(p, {"a": {"id": "a", "v": 2}})
            self.assertEqual([c["id"] for c in doc["cues"]], ["a", "b"])
            doc = spec.write_manifest(p, {"b": {"id": "b", "v": 3}})
            self.assertEqual([c.get("v") for c in doc["cues"]], [2, 3])


class LoopTests(unittest.TestCase):
    def test_fold_makes_stems_periodic(self):
        L = 1000
        a = np.zeros((2, 1700))
        a[:, 900:1700] = 1.0  # a note that rings 700 samples past the cycle end
        out = render.fold({"x": a}, L / SR)["x"]
        self.assertEqual(out.shape, (2, L))
        self.assertTrue(np.allclose(out[:, :700], 1.0))  # the tail landed on the start
        self.assertTrue(np.allclose(out[:, 900:], 1.0))
        b = np.zeros((1, 3500))
        b[0, 1000:] = 1.0  # a 2500-sample tail wraps two and a half times
        self.assertTrue(np.allclose(render.fold({"y": b}, L / SR)["y"], np.array([[3.0] * 500 + [2.0] * 500])))

    def test_wrap(self):
        a = np.arange(10.0)[np.newaxis, :]
        w = render._wrap(a, 3)
        self.assertEqual(w[0].tolist(), [7, 8, 9] + list(range(10)) + [0, 1, 2])
        self.assertEqual(render._wrap(a, 25).shape[1], 60)

    def test_rendered_loop_is_seamless(self):
        from composer.cues import common as C

        s = Score(bpm=120)
        p = s.part("pulse")
        for k in range(8):  # two bars of eighths; the last notes ring past the cycle end
            p.note(57 + (k % 4) * 3, 0.5 * k, 0.45, 80)
        arr = render.Arrangement("t", s, 4.0, [C.pulse("pulse", fader=0.0, delay=True)], preset="bed", loop=True, tail=2.0, wrap=2.0,
                                 reverbs=C.reverbs())
        r = render.render(arr, Path("/tmp"))
        self.assertEqual(r.master.shape[1], 4 * SR)
        seam = analysis.loop_seam(r.master)
        self.assertLess(seam["clickRatio"], 2.0)
        self.assertTrue(np.all(np.isfinite(r.master)))


class SafeCompressorTests(unittest.TestCase):
    def test_no_nan_in_digital_silence_after_loud_audio(self):
        x = np.zeros((2, SR * 2))
        x[:, : SR // 2] = 0.9 * np.sin(2 * np.pi * 220 * np.arange(SR // 2) / SR)
        x[:, SR // 2 : SR // 2 + 400] = 1e-15  # the tiny residue that made the engine's RMS detector read negative
        comp = render.SafeCompressor(threshold_db=-20, ratio=3, detector="rms", rms_ms=10)
        out, gr = comp.process(x)
        self.assertTrue(np.all(np.isfinite(out)))
        self.assertTrue(np.all(np.isfinite(gr)))
        self.assertLess(gr.min(), -3.0)  # it still compresses the loud part


class AuditTests(unittest.TestCase):
    def test_clash_detection(self):
        s = Score(bpm=100)
        s.part("a").note("E4", 0, 2, 80)
        s.part("b").note("F5", 0.5, 2, 80)  # a minor ninth, held
        s.part("c").note("G4", 0, 2, 80)  # a third above E: fine
        c = audit.clashes(s)
        self.assertEqual(len(c), 1)
        self.assertEqual({c[0]["a"], c[0]["b"]}, {"a:E4", "b:F5"})

    def test_ranges(self):
        s = Score(bpm=100)
        s.part("bass").note("C1", 0, 1, 80)
        r = audit.ranges(s)
        self.assertFalse(r[0]["ok"])


def _pitch_midi(audio, expected_midi: float) -> float:
    """Strongest spectral peak within +-7 semitones of the expected note (so an octave error shows)."""
    m = np.asarray(audio).mean(axis=0)
    i = int(np.argmax(np.abs(m) > 0.05 * np.abs(m).max()))
    seg = m[i + int(0.05 * SR): i + int(0.85 * SR)]
    n = 1 << 17
    spec = np.abs(np.fft.rfft(seg * np.hanning(seg.size), n))
    f = np.fft.rfftfreq(n, 1.0 / SR)
    f0 = 440.0 * 2 ** ((expected_midi - 69) / 12)
    band = (f > f0 * 2 ** (-7 / 12)) & (f < f0 * 2 ** (7 / 12))
    lowest_strong = f[band][np.argmax(spec[band] > 0.3 * spec[band].max())]
    return 69 + 12 * math.log2(lowest_strong / 440.0)


@unittest.skipUnless(VCSL_OK, "VCSL samples not installed (scripts/audio/setup.sh)")
class PitchTests(unittest.TestCase):
    """VCSL file names mix octave conventions (the Kawai, upright, vibraphone, marimba, glockenspiel
    and kalimba name middle C "C3"). composer.instruments corrects them; a written A4 must sound
    at 440 Hz, not 880 Hz."""

    def test_written_pitch_is_sounding_pitch(self):
        from composer import instruments as I

        for name, sampler, note in (("kawai", I.piano("kawai"), 69), ("vibes", I.vibes(), 69), ("marimba", I.marimba(), 69),
                                    ("harp", I.harp(), 69), ("glock", I.glock(), 84), ("bowed vibes", I.vibes_bowed(), 69),
                                    ("kalimba", I.kalimba(), 69)):
            a = sampler.render_events([(note, 0.0, 1.0, 90)], 1.5)
            got = _pitch_midi(a, note)
            self.assertAlmostEqual(got, note, delta=0.3, msg=f"{name}: written {note} sounds {got:.2f}")


@unittest.skipUnless(VCSL_OK, "VCSL samples not installed (scripts/audio/setup.sh)")
class RegistryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from composer.cues import REGISTRY

        cls.registry = REGISTRY
        cls.arrangements = {cid: cue.build() for cid, cue in REGISTRY.items()}

    def test_deliverables_are_all_there(self):
        ids = set(self.registry)
        need = {"theme-full", "theme-15s", "theme-5s", "intro-sting-show", "intro-sting-zoora", "endscreen-bed",
                "bumper-rekt-meter", "bumper-red-flag", "bumper-one-fix", "bumper-scam-of-the-week", "bumper-developing", "bumper-correction",
                "bed-show-neutral", "bed-show-tension", "bed-show-light",
                "bed-story-curious", "bed-story-tension", "bed-story-ominous", "bed-story-resolve"}
        self.assertEqual(ids, need)

    def test_every_cue_states_the_motif(self):
        for cid, arr in self.arrangements.items():
            st = motif.statements(arr.score)
            self.assertGreaterEqual(len(st), 1, cid)
            self.assertTrue(all(s["ok"] for s in st), f"{cid}: {[s for s in st if not s['ok']]}")

    def test_lengths(self):
        for cid, arr in self.arrangements.items():
            cue = self.registry[cid]
            if cue.loop:
                self.assertTrue(60.0 <= arr.length <= 90.0, cid)
                self.assertAlmostEqual(arr.length, cue.bars * 4 * 60.0 / cue.bpm, places=9, msg=cid)
                self.assertAlmostEqual(arr.length * 30, round(arr.length * 30), places=6, msg=f"{cid}: whole video frames")
                self.assertAlmostEqual(arr.length * SR, round(arr.length * SR), places=6, msg=cid)
            elif cue.cue_type == "bumper":
                self.assertTrue(2.0 <= arr.length <= 4.0, cid)
            elif cue.cue_type == "intro-sting":
                self.assertTrue(3.0 <= arr.length <= 5.0, cid)
        self.assertTrue(60 <= self.arrangements["theme-full"].length <= 75)
        self.assertEqual(self.arrangements["theme-15s"].length, 15.0)
        self.assertEqual(self.arrangements["theme-5s"].length, 5.0)
        self.assertEqual(self.arrangements["endscreen-bed"].length, 20.0)

    def test_frame_aligned_tempos(self):
        for cid, cue in self.registry.items():
            if cid == "intro-sting-show":
                continue  # timed to the sting's frames instead
            self.assertAlmostEqual(spec.frames_per_beat(cue.bpm), round(spec.frames_per_beat(cue.bpm)), msg=cid)

    def test_profiles(self):
        for cid, cue in self.registry.items():
            arr = self.arrangements[cid]
            self.assertEqual(arr.preset, cue.profile, cid)
            self.assertEqual(arr.loop, cue.loop, cid)
            if cue.cue_type in ("bumper", "intro-sting"):
                self.assertEqual(cue.profile, "sting", cid)
            if cue.cue_type == "bed":
                self.assertTrue(cue.loop, cid)

    def test_sting_hits_match_the_branding_frames(self):
        from composer.cues import show_cues, zoora

        self.assertAlmostEqual(show_cues.STING_HIT1 * 30, 30)
        self.assertAlmostEqual(show_cues.STING_HIT2 * 30, 58)
        self.assertAlmostEqual(zoora.ZOORA_HIT * 30, 54)
        sting = self.arrangements["intro-sting-show"].score
        show = [s for s in motif.statements(sting) if s["part"] == "piano"][0]
        self.assertAlmostEqual(sting.seconds(show["starts"][-1]), show_cues.STING_HIT1, delta=0.03)  # SHOW (humanised by a few ms)
        bad = [s for s in motif.statements(sting, "badger") if s["part"] == "bass"][0]
        self.assertAlmostEqual(sting.seconds(bad["starts"][-1]), show_cues.STING_HIT2, delta=0.03)

    def test_no_unintended_clashes_in_the_theme(self):
        # the A-form voicings put a 9-b3 cluster in the EP and the A7b9 puts b9 over A: those are intended;
        # anything held against the strings' top line or under the motif's landing would show up here
        c = audit.clashes(self.arrangements["theme-full"].score, min_overlap=0.5)
        unintended = [x for x in c if not ({x["a"].split(":")[0], x["b"].split(":")[0]} <= {"ep", "celli", "bass"})]
        self.assertEqual(unintended, [])


@unittest.skipUnless((PUBLIC / "manifest.json").exists(), "no delivered music (run scripts/audio/music/build.py)")
class DeliveredFilesTests(unittest.TestCase):
    def test_manifest_matches_files(self):
        import soundfile as sf

        doc = json.loads((PUBLIC / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(doc["sampleRate"], 48000)
        for cue in doc["cues"]:
            f = paths.STUDIO / "public" / cue["file"]
            self.assertTrue(f.exists(), cue["id"])
            self.assertLessEqual(f.stat().st_size, spec.MAX_BYTES, cue["id"])
            info = sf.info(str(f))
            self.assertEqual(info.samplerate, 48000, cue["id"])
            self.assertEqual(info.channels, 2, cue["id"])
            self.assertEqual(info.frames, cue["durationSamples"], cue["id"])
            if cue["loop"]:
                self.assertEqual(cue["loop"]["endSample"], info.frames, cue["id"])
            meta = json.loads((paths.STUDIO / "public" / cue["metadata"]).read_text(encoding="utf-8"))
            for k in ("key", "bpm", "cueType", "mood", "loudness", "loop", "selfReview", "motif"):
                self.assertIn(k, meta, cue["id"])
            self.assertTrue(meta["checks"]["pass"], cue["id"])
            self.assertTrue(all(s["ok"] for s in meta["motif"]["zoo"]), cue["id"])


if __name__ == "__main__":
    unittest.main()
