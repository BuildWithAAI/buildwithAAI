import io as _io
import json
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

import numpy as np

import duck as duck_cli
from audiolib import duck, io, synth
from audiolib.core import SR


def speechlike(pattern, seed=1):
    """Band-limited noise bursts: pattern = [(start_s, end_s), ...] inside a 10 s file."""
    g = np.random.default_rng(seed)
    n = 10 * SR
    x = np.zeros(n)
    for a, b in pattern:
        i0, i1 = int(a * SR), int(b * SR)
        burst = g.standard_normal(i1 - i0)
        env = np.minimum(1, np.minimum(np.arange(i1 - i0), np.arange(i1 - i0)[::-1]) / (0.02 * SR))
        x[i0:i1] = burst * env * 0.2
    from audiolib import dsp

    return dsp.apply_sos(x, dsp.butter("bandpass", (200, 3500), 2))[0][None, :]


PATTERN = [(1.0, 2.0), (2.2, 3.5), (5.0, 6.0)]  # a 0.2 s word gap, then a 1.5 s pause


class DuckTest(unittest.TestCase):
    def test_activity_fills_word_gaps_not_pauses(self):
        act = duck.voice_activity(speechlike(PATTERN))
        self.assertTrue(act[int(2.1 * SR)])  # the 0.2 s gap stays speech
        self.assertFalse(act[int(4.2 * SR)])  # the 1.5 s pause opens
        self.assertTrue(act[int(5.5 * SR)])
        self.assertFalse(act[int(0.5 * SR)])
        self.assertFalse(act[int(8.0 * SR)])

    def test_gain_curve(self):
        act = duck.voice_activity(speechlike(PATTERN))
        g = duck.duck_gain(act, depth_db=6.0, attack=0.15, release=0.5, lookahead=0.12)
        self.assertAlmostEqual(g[int(1.5 * SR)], -6.0, places=6)
        self.assertAlmostEqual(g[int(8.0 * SR)], 0.0, places=6)
        self.assertLess(g[int(0.99 * SR)], -3.0)  # lookahead: already mostly ducked as the first word lands
        self.assertLess(g[int(3.6 * SR)], -5.0)  # release starts after the speech, not before it
        step = np.max(np.abs(np.diff(g)))
        self.assertLess(step, 6.0 / (0.15 * SR) * 1.01)  # never faster than the attack rate: no zipper
        intervals = duck.activity_from_intervals(PATTERN, 10 * SR)
        self.assertTrue(intervals[int(2.1 * SR)])
        self.assertFalse(intervals[int(4.2 * SR)])

    def test_frame_gains(self):
        g = np.concatenate([np.zeros(SR), np.full(SR, -6.0)])
        fr = duck.frame_gains(g, fps=30)
        self.assertEqual(len(fr), 60)
        self.assertEqual(fr[0], 1.0)
        self.assertAlmostEqual(fr[-1], 10 ** (-6 / 20), places=4)

    def test_cli(self):
        with tempfile.TemporaryDirectory() as d:
            d = Path(d)
            bed = synth.noise(4 * SR, "pink") * 0.05
            io.write(d / "bed.wav", np.vstack([bed, bed]))
            io.write(d / "voice.wav", speechlike(PATTERN))
            out_buf = _io.StringIO()
            with redirect_stdout(out_buf), redirect_stderr(_io.StringIO()):
                # --depth alone keeps the old broadband behaviour
                code = duck_cli.main(["--bed", str(d / "bed.wav"), "--voice", str(d / "voice.wav"), "--out", str(d / "out.wav"), "--frames", str(d / "g.json"), "--depth", "6"])
                missing = duck_cli.main(["--bed", str(d / "nope.wav"), "--voice", str(d / "voice.wav"), "--out", str(d / "x.wav")])
                split = duck_cli.main(["--bed", str(d / "bed.wav"), "--voice", str(d / "voice.wav"), "--out", str(d / "split.wav"), "--frames", str(d / "s.json")])
                bad = duck_cli.main(["--bed", str(d / "bed.wav"), "--voice", str(d / "voice.wav"), "--out", str(d / "x.wav"), "--depths", "1,2"])
            self.assertEqual(code, 0)
            out = io.read(d / "out.wav")
            self.assertEqual(out.shape, (2, 10 * SR))  # the 4 s bed was looped to the voice length
            frames = json.loads((d / "g.json").read_text())
            self.assertEqual((frames["fps"], frames["mode"], len(frames["gains"])), (30, "broadband", 300))
            self.assertEqual(missing, 2)
            self.assertEqual(split, 0)  # the default is the band-split duck
            sf = json.loads((d / "s.json").read_text())
            self.assertEqual((sf["mode"], sf["crossoversHz"], sf["depthsDb"]), ("split", [700.0, 5000.0], [2.0, 12.0, 4.0]))
            self.assertEqual(sorted(sf["bands"]), ["high", "low", "mid"])
            self.assertTrue(all(len(v) == 300 for v in sf["bands"].values()))
            self.assertAlmostEqual(min(sf["bands"]["mid"]), 10 ** (-12 / 20), places=3)
            summaries = [json.loads(line) for line in out_buf.getvalue().splitlines() if line.startswith("{")]
            self.assertEqual([s["mode"] for s in summaries], ["broadband", "split"])
            self.assertEqual(summaries[1]["gainUnderSpeechDb"], [-2.0, -12.0, -4.0])
            self.assertEqual((summaries[0]["releaseS"], summaries[0]["minGapS"]), (0.5, 0.35))  # broadband keeps its timing
            self.assertEqual((summaries[1]["releaseS"], summaries[1]["minGapS"]), (1.2, 0.8))  # the split duck's
            self.assertEqual(bad, 2)


class SplitDuckTest(unittest.TestCase):
    def test_bands_sum_back_to_the_input(self):
        x = np.vstack([synth.noise(SR, "white", "a"), synth.noise(SR, "pink", "b")]) * 0.3
        bands = duck.split_bands(x)
        self.assertEqual(len(bands), 3)
        self.assertLess(float(np.max(np.abs(sum(bands) - x))), 1e-9)  # exact: no ducking means no change at all
        with self.assertRaises(ValueError):
            duck.split_bands(x, (5000.0, 700.0))
        with self.assertRaises(ValueError):
            duck.split_bands(x, (700.0, 30000.0))

    def test_each_band_ducks_by_its_own_depth(self):
        t = np.arange(5 * SR) / SR
        act = np.zeros(t.size, dtype=bool)
        act[SR : 3 * SR] = True
        for f, want in ((150.0, -2.0), (2000.0, -12.0), (12000.0, -4.0)):
            tone = np.sin(2 * np.pi * f * t)[None, :] * 0.2
            out, gains = duck.split_duck(tone, act)
            seg = slice(int(1.6 * SR), int(2.6 * SR))  # fully ducked, away from the ramps
            got = 20 * np.log10(np.sqrt(np.mean(out[:, seg] ** 2)) / np.sqrt(np.mean(tone[:, seg] ** 2)))
            self.assertAlmostEqual(got, want, delta=0.25, msg=f"{f} Hz")
            rest = slice(int(4.4 * SR), 5 * SR)  # released again after the speech (the split release takes 1.2 s)
            self.assertAlmostEqual(float(np.sqrt(np.mean(out[:, rest] ** 2))), float(np.sqrt(np.mean(tone[:, rest] ** 2))), delta=1e-3)
        self.assertEqual(len(gains), 3)
        with self.assertRaises(ValueError):
            duck.split_duck(tone, act, depths=(2.0, 12.0))

    def test_split_timing_does_not_bloom_on_short_pauses(self):
        # critic round 2: the split duck fills pauses under 0.8 s and releases over 1.2 s, so the 12 dB mid
        # band does not come back up between phrases a fraction of a second apart
        self.assertEqual((duck.SPLIT_MIN_GAP, duck.SPLIT_RELEASE), (0.8, 1.2))
        act = np.zeros(6 * SR, dtype=bool)
        for a, b in ((0.5, 1.5), (2.1, 3.0), (4.5, 5.5)):  # a 0.6 s pause, then a 1.5 s one
            act[int(a * SR): int(b * SR)] = True
        wide = duck.widen(act, duck.SPLIT_MIN_GAP)
        self.assertTrue(wide[int(1.8 * SR)])  # the 0.6 s pause stays ducked
        self.assertFalse(wide[int(3.8 * SR)])  # the 1.5 s pause opens
        mid = duck.split_duck_gains(wide)[1]
        self.assertLess(mid[int(1.8 * SR)], -11.9)
        self.assertGreater(mid[int(4.2 * SR)], -1.0)  # 1.2 s after the phrase, released
        self.assertLess(mid[int(3.4 * SR)], -6.0)  # but slowly: 0.4 s in, still more than 6 dB down
        old = duck.duck_gain(duck.widen(act, 0.35), 12.0, release=0.5)
        self.assertGreater(old[int(1.9 * SR)], -7.0)  # the old timing let the mids up in the short pause


if __name__ == "__main__":
    unittest.main()
