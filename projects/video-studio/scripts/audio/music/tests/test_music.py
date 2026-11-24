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
from composer import audit, motif, notation, render, spec, synths, targets, voicegate  # noqa: E402

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


class KickTuningTests(unittest.TestCase):
    """KICK-FIX (critic round 1): the kick's body agrees with the bass note it plays under."""

    def test_kick_pitch_follows_the_bass(self):
        hz = lambda m: 440.0 * 2 ** ((m - 69) / 12)  # noqa: E731
        # D2: no D between 45 and 62 Hz (D1 36.7, D2 73.4), so its fifth, A1 (55 Hz)
        cases = {"D2": hz(33), "A1": hz(33), "Bb1": hz(34), "G1": hz(31), "Eb2": hz(34), "E2": hz(35), "F2": hz(36), "Ab2": hz(32), "C#2": hz(32)}
        from audiolib.core import note_number

        for name, want in cases.items():
            self.assertAlmostEqual(synths.kick_pitch_for(note_number(name)), want, delta=0.01, msg=name)
        for m in range(24, 60):  # always inside the kick's range: 45-66 Hz
            self.assertTrue(45.0 <= synths.kick_pitch_for(m) <= 66.0, m)

    def test_kick_tuning_tags_hits_and_the_cache_sees_it(self):
        s = Score(bpm=100)
        bass, kick = s.part("bass"), s.part("kick")
        bass.note("Bb1", 0.0, 2.0, 90)
        bass.note("D2", 2.0, 2.0, 90)
        kick.hit(36, 0.0, 100)
        kick.hit(36, 2.0, 100)
        kick.hit(36, 6.0, 100)  # no bass under it: untouched
        self.assertEqual(synths.kick_tuning(s), 1)
        self.assertEqual([n.meta.get("tune_hz") for n in kick.notes], [58.27, 55.0, None])
        arr = render.Arrangement("t", s, 4.0, [render.Track("kick", synths.SynthKick(), part="kick")])
        k1 = render._stem_key(arr, arr.tracks[0], 4.0)
        kick.notes[0].meta["tune_hz"] = 49.0
        self.assertNotEqual(k1, render._stem_key(arr, arr.tracks[0], 4.0))

    def test_kick_is_short(self):
        k = synths.SynthKick()
        self.assertEqual((k.amp_decay, k.drive_db), (0.11, 2.0))

        def tail_db(kick):
            h = kick.hit()
            tail = h[int(0.25 * SR): int(0.3 * SR)]
            return 20 * np.log10(np.sqrt(np.mean(tail ** 2)) / np.max(np.abs(h)))

        new, old = tail_db(k), tail_db(synths.SynthKick(amp_decay=0.2, drive_db=4.0))
        self.assertLess(new, -20.0)  # 0.25-0.30 s after the hit: the body has gone (an 808-style boom has not)
        self.assertLess(new, old - 7.0)


class FingerBassTests(unittest.TestCase):
    """BASS-FIX acceptance (critic round 1): after the bass strip, <= -15 dB of the bass's power at
    1-4 kHz and >= -4 dB under 150 Hz (the old plucked string read -3.6 and -9.7)."""

    @staticmethod
    def _shares(a):
        from scipy.signal import welch

        f, pw = welch(a.mean(axis=0) * np.sqrt(2), fs=SR, nperseg=8192)
        tot = pw[(f >= 20) & (f <= 20000)].sum()
        return (10 * np.log10(pw[(f >= 20) & (f < 150)].sum() / tot), 10 * np.log10(pw[(f >= 1000) & (f < 4000)].sum() / tot))

    def test_band_and_bed_strips_meet_the_acceptance(self):
        from audiolib.mix import Mix, Strip
        from composer.cues import common as C

        s = Score(bpm=100)
        p = s.part("bass")
        notation.line(p, 0, "D2:.75 D2:.75 Bb1:1 F2:.5 Ab2:.5 Bb1:.5 A1:1.25 A1:.25 E2:.5 r:.5 G2:.5 E2:.5 C#2:.5", vel=92, staccato=0.88)
        raw = synths.fingered_bass("t").render(p, s, 6.0)
        for lp in (C.BASS_LP_BAND, C.BASS_LP_BED):
            tr = C.bass(lp=lp)
            out, _, _ = Mix(length=6.0, room=None, glue=None).process_strip(Strip("bass", raw, eq=tr.eq, comp=tr.comp, sat=tr.sat, width=0.0))
            low, mid = self._shares(out)
            self.assertGreaterEqual(low, -4.0, f"lp {lp}: {low:.1f} dB under 150 Hz")
            self.assertLessEqual(mid, -15.0, f"lp {lp}: {mid:.1f} dB at 1-4 kHz")

    def test_pitch_is_exact(self):
        a = synths.finger_pluck(45, 1.5, 0.7)  # A2, 110 Hz
        seg = a[int(0.05 * SR): int(1.0 * SR)]
        n = 1 << 18
        sp = np.abs(np.fft.rfft(seg * np.hanning(seg.size), n))
        f = np.fft.rfftfreq(n, 1 / SR)
        band = (f > 90) & (f < 130)
        self.assertAlmostEqual(float(f[band][np.argmax(sp[band])]), 110.0, delta=0.4)


class PreRollTests(unittest.TestCase):
    def test_pre_roll_is_silence_before_the_master(self):
        from composer.cues import common as C

        s = Score(bpm=120)
        s.part("pulse").note("A3", 0.0, 1.0, 90)
        arr = render.Arrangement("t", s, 1.0, [C.pulse("pulse", fader=0.0, delay=False)], preset="sting", reverbs=C.reverbs(), pre_roll=2 / 30)
        r = render.render(arr, Path("/tmp"))
        k = int(round(2 / 30 * SR))
        self.assertEqual(r.master.shape[1], SR + k)
        self.assertEqual(float(np.max(np.abs(r.master[:, :k]))), 0.0)
        self.assertGreater(float(np.max(np.abs(r.master[:, k: k + int(0.05 * SR)]))), 0.01)
        self.assertEqual(r.master_report["preRollSec"], round(k / SR, 6))


class MixAutomationTests(unittest.TestCase):
    """Peak shaving (Badger's tracks) and the bus ride (theme-full's arc), critic round 1."""

    @staticmethod
    def _clicks(scale=1.0):
        x = np.zeros((2, SR))
        g = np.random.default_rng(5)
        for t in (0.1, 0.4, 0.7):  # three 2 ms clicks, each followed by a quiet 300 Hz body
            k = int(t * SR)
            x[:, k: k + 96] = g.standard_normal(96) * 0.9
            n = int(0.29 * SR) - 96
            x[:, k + 96: k + 96 + n] = 0.05 * np.sin(2 * np.pi * 300 * np.arange(n) / SR)
        return x * scale

    def test_shave_peaks_takes_the_peak_down_by_the_amount(self):
        x = self._clicks()
        pk = 20 * np.log10(np.max(np.abs(x)))
        for kind, tol in (("limit", 0.5), ("clip", 1.5)):  # the clip's oversampling filter rings back up a little
            y = render.shave_peaks(x, 8.0, kind=kind)
            got = pk - 20 * np.log10(np.max(np.abs(y)))
            self.assertAlmostEqual(got, 8.0, delta=tol, msg=kind)
            body = slice(int(0.30 * SR), int(0.38 * SR))  # the body, once the limiter has released, is untouched
            self.assertLess(np.max(np.abs(y[:, body] - x[:, body])), 0.003, kind)

    def test_shave_peaks_does_not_depend_on_level(self):
        x = self._clicks()
        for kind in ("limit", "clip"):
            a = render.shave_peaks(x, 10.0, kind=kind)
            b = render.shave_peaks(x * 0.1, 10.0, kind=kind) * 10.0
            self.assertLess(np.max(np.abs(a - b)), 1e-3, kind)

    def test_shave_peaks_edge_cases(self):
        x = self._clicks()
        self.assertTrue(np.array_equal(render.shave_peaks(x, 0.0), x))
        self.assertTrue(np.array_equal(render.shave_peaks(np.zeros((2, 100)), 6.0), np.zeros((2, 100))))
        with self.assertRaises(ValueError):
            render.shave_peaks(x, 6.0, kind="gate")

    def test_ride_gain(self):
        g = render.ride_gain([(1.0, 0.0), (2.0, -6.0)], 3 * SR)
        db = 20 * np.log10(g)
        self.assertAlmostEqual(db[0], 0.0, places=6)  # held before the first point
        self.assertAlmostEqual(db[int(1.5 * SR)], -3.0, places=3)  # linear in dB between points
        self.assertAlmostEqual(db[-1], -6.0, places=6)  # held after the last
        off = render.ride_gain([(0.0, 0.0), (1.0, -6.0)], 2 * SR, offset=SR)
        self.assertAlmostEqual(20 * np.log10(off[SR]), 0.0, places=6)  # sample `offset` is time 0

    def test_theme_full_ride_and_badger_peak_control(self):
        from composer.cues import theme

        pts = theme.full_ride()
        spb = 60.0 / theme.BPM
        times = {name: bar * theme.BAR * spb for name, bar, _ in theme.FULL_RIDE_DB}
        for name, _, g in theme.FULL_RIDE_DB[1:]:
            self.assertIn((times[name], g), pts, name)  # each section's gain is reached on its downbeat
        self.assertEqual(theme.arrangement("theme-full", "full").bus_ride, pts)
        for kind in ("15s", "5s"):
            self.assertEqual(theme.arrangement(f"theme-{kind}", kind).bus_ride, [], kind)
        db = dict((n, g) for n, _, g in theme.FULL_RIDE_DB)
        self.assertLessEqual(db["B"] - db["A"], -0.5)  # the ride only helps the arc the arrangement writes
        self.assertGreaterEqual(db["A'"] - db["A"], 0.5)
        tr = {t.name: t for t in theme.arrangement("theme-15s", "15s").tracks}
        self.assertEqual(tr["badger_xstick"].peak_shave, theme.BADGER_XSTICK_SHAVE)
        self.assertEqual(tr["badger_mid"].peak_shave, theme.BADGER_MID_SHAVE)


class TargetsTests(unittest.TestCase):
    def test_music_targets(self):
        t = targets.music_targets()
        bed = {c["id"]: c for c in t["profiles"]["bed"]["checks"]}
        self.assertEqual(bed["spectrum.voicePocketDb"]["severity"], "warn")
        self.assertEqual((bed["voice.index"]["min"], bed["voice.index"]["severity"]), (0.75, "fail"))
        self.assertEqual(bed["voice.indexMinusSsn"]["min"], 0.0)
        end = {c["id"]: c for c in t["profiles"]["endscreen"]["checks"]}
        self.assertEqual((end["loudness.integrated"]["min"], end["loudness.integrated"]["max"]), (-18.5, -17.5))
        for prof, sev in (("standalone", "fail"), ("endscreen", "fail"), ("sting", "warn")):
            aac = [c for c in t["profiles"][prof]["checks"] if c["id"] == "aac.truePeak128k"]
            self.assertEqual((len(aac), aac[0]["severity"]), (1, sev), prof)
        import json as _json

        engine = _json.loads(Path(paths.TARGETS).read_text(encoding="utf-8"))
        self.assertNotIn("endscreen", engine["profiles"])  # the engine's own file is untouched

    @unittest.skipUnless(__import__("shutil").which("ffmpeg"), "no ffmpeg")
    def test_aac_true_peak_is_the_worst_of_several_encodes(self):
        import tempfile

        import soundfile as sf

        t = np.arange(SR) / SR
        x = 0.7 * np.sin(2 * np.pi * 440.0 * t) * np.minimum(1.0, t * 20)
        with tempfile.TemporaryDirectory() as d:
            w = Path(d) / "tone.wav"
            sf.write(str(w), np.stack([x, x], axis=1), SR, subtype="PCM_24")
            st = targets.aac_true_peak_stats(w, variants=2)
            self.assertEqual(len(st["values"]), 3)
            self.assertEqual(st["worst"], max(st["values"]))
            self.assertLessEqual(st["median"], st["worst"])
            self.assertTrue(-4.5 < st["worst"] < 0.0)  # a -3.1 dBFS tone stays near its level after AAC
            self.assertEqual(targets.aac_true_peak(w, variants=2), st["worst"])

    def test_music_presets(self):
        p = render.safe_preset("endscreen")
        self.assertEqual((p.target, p.measure, p.ceiling_dbtp), (-18.0, "integrated", -2.0))
        self.assertEqual(render.safe_preset("standalone", render.STANDALONE_CEILING_DBTP).ceiling_dbtp, -2.2)
        self.assertIsInstance(p.comp, render.SafeCompressor)


@unittest.skipUnless(voicegate.PROFILE.exists(), "no voice profile (run voicegate.py --make-profile)")
class VoiceGateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ref = voicegate.voice()

    def test_profile_decodes(self):
        r = self.ref
        self.assertEqual(r.lv.shape, (len(voicegate.SII_FC), r.frames))
        self.assertEqual(r.speech.size, r.frames)
        self.assertGreater(r.speech.mean(), 0.3)
        self.assertGreater(r.act.mean(), 0.3)
        self.assertTrue(-20.0 < r.voice_lufs < -10.0)
        self.assertEqual(r.n, int(round(r.doc["source"]["durationSec"] * SR)))

    def test_quiet_bed_passes_and_loud_noise_fails(self):
        g = np.random.default_rng(3)
        noise = g.standard_normal((2, 4 * SR))
        quiet = voicegate.evaluate(noise * 10 ** (-60 / 20), self.ref)
        loud = voicegate.evaluate(noise * 10 ** (-12 / 20), self.ref)
        self.assertGreater(quiet["index"], 0.9)
        self.assertLess(loud["index"], 0.5)
        self.assertGreater(quiet["split"]["voiceOverBedLu"], loud["split"]["voiceOverBedLu"] + 30)
        self.assertLess(quiet["broadband6"]["index"], quiet["split"]["index"] + 0.05)
        for k in ("index", "indexMinusSsn", "split", "broadband6", "ssnAtSplitLoudness", "reference"):
            self.assertIn(k, quiet)


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
        beds = {"bed-show-neutral", "bed-show-tension", "bed-show-light", "bed-story-curious", "bed-story-tension", "bed-story-ominous", "bed-story-resolve"}
        need = {"theme-full", "theme-15s", "theme-5s", "intro-sting-show", "intro-sting-zoora", "endscreen-bed", "endscreen-music",
                "bumper-rekt-meter", "bumper-red-flag", "bumper-one-fix", "bumper-scam-of-the-week", "bumper-developing", "bumper-correction",
                *beds, *{f"{b}-underscore" for b in beds}}
        self.assertEqual(ids, need)

    def test_every_cue_states_the_motif(self):
        for cid, arr in self.arrangements.items():
            st = motif.statements(arr.score)
            if cid.endswith("-underscore"):
                self.assertEqual(st, [], f"{cid}: an underscore has no motif statements")
                continue
            self.assertGreaterEqual(len(st), 1, cid)
            self.assertTrue(all(s["ok"] for s in st), f"{cid}: {[s for s in st if not s['ok']]}")

    def test_no_bed_line_in_zoos_f0_range(self):
        # critic round 1: the pulses and motif statements under speech moved out of Zoo's F0 band (the
        # critic's 85-180 Hz); only the bass, sub, drums, drones and comping live down there
        allowed = {"bass", "sub", "kick", "kit", "basses", "basses_trem", "pizz_lo", "celli", "celli_fast", "violas", "violas_trem", "pad", "piano", "ep"}
        for cid, arr in self.arrangements.items():
            if self.registry[cid].cue_type != "bed":
                continue
            for name in ("pulse", "vibes", "vibes_hard", "violins", "pizz"):
                part = arr.score.parts.get(name)
                if part is None or name in allowed:
                    continue
                low = [n for n in part.notes if 440.0 * 2 ** ((n.pitch - 69) / 12) < 180.0]
                self.assertEqual(low, [], f"{cid}: {name} has notes under 180 Hz")
            for s in motif.statements(arr.score):
                self.assertGreaterEqual(min(s["pitches"]), 62, f"{cid}: a motif statement in {s['part']} starts under D4")

    def test_theme_15s_states_the_motif_twice(self):
        # one statement per part, so group them by beat (humanising moves each part a few ms)
        starts = {round(s["starts"][0]) for s in motif.statements(self.arrangements["theme-15s"].score)}
        self.assertEqual(starts, {0, 16})  # the intro and the coda (the G bar now answers instead)

    def test_badger_has_a_mid_register_double_and_his_own_cross_stick(self):
        for cid in ("theme-full", "theme-15s", "theme-5s", "intro-sting-show", "bumper-red-flag"):
            sc = self.arrangements[cid].score
            mid = [s for s in motif.statements(sc, "badger") if s["part"] == "badger_mid"]
            self.assertTrue(mid and all(s["pitches"] == [63, 62] for s in mid), cid)  # E-flat 4, D4
            self.assertTrue(sc.parts["badger_xstick"].notes, cid)
            self.assertIn("badger_xstick", [t.name for t in self.arrangements[cid].tracks], cid)

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
        five = self.arrangements["theme-5s"]
        self.assertAlmostEqual(five.length + five.pre_roll, 5.0, places=9)  # 2 frames of silence, then the downbeat
        self.assertAlmostEqual(five.pre_roll * 30, 2.0, places=9)
        self.assertAlmostEqual(self.registry["theme-5s"].downbeat_sec, five.pre_roll)
        self.assertEqual(self.arrangements["endscreen-bed"].length, 20.0)
        self.assertEqual(self.arrangements["endscreen-music"].length, 20.0)

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
        self.assertEqual(self.registry["endscreen-music"].profile, "endscreen")
        for cid in ("theme-full", "theme-15s"):
            self.assertEqual(self.arrangements[cid].ceiling_dbtp, render.STANDALONE_CEILING_DBTP, cid)

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
        zo = self.arrangements["intro-sting-zoora"].score
        self.assertFalse(zo.parts["celesta"].notes)  # critic round 1: no celesta (weak provenance, a late attack)
        lead = [s for s in motif.statements(zo) if s["part"] == "vibes_hard"][0]
        self.assertAlmostEqual(zo.seconds(lead["starts"][-1]), zoora.ZOORA_HIT, delta=0.03)
        hits = {round(h[0], 3): h[1] for h in self.registry["intro-sting-zoora"].hits}
        self.assertNotIn("SHOW", " ".join(hits.values()))

    def test_no_unintended_clashes_in_the_theme(self):
        # the A-form voicings put a 9-b3 cluster in the EP and the A7b9 puts b9 over A: those are intended;
        # anything held against the strings' top line or under the motif's landing would show up here
        for cid in ("theme-full", "theme-15s"):
            c = audit.clashes(self.arrangements[cid].score, min_overlap=0.5)
            unintended = [x for x in c if not ({x["a"].split(":")[0], x["b"].split(":")[0]} <= {"ep", "celli", "bass"})]
            self.assertEqual(unintended, [], cid)


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
