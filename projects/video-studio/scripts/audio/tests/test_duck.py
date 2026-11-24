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
            with redirect_stdout(_io.StringIO()), redirect_stderr(_io.StringIO()):
                code = duck_cli.main(["--bed", str(d / "bed.wav"), "--voice", str(d / "voice.wav"), "--out", str(d / "out.wav"), "--frames", str(d / "g.json")])
                missing = duck_cli.main(["--bed", str(d / "nope.wav"), "--voice", str(d / "voice.wav"), "--out", str(d / "x.wav")])
            self.assertEqual(code, 0)
            out = io.read(d / "out.wav")
            self.assertEqual(out.shape, (2, 10 * SR))  # the 4 s bed was looped to the voice length
            frames = json.loads((d / "g.json").read_text())
            self.assertEqual((frames["fps"], len(frames["gains"])), (30, 300))
            self.assertEqual(missing, 2)


if __name__ == "__main__":
    unittest.main()
