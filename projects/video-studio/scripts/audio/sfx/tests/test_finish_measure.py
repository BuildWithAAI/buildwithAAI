"""Finishing chain and measurements."""

import math
import unittest

import numpy as np

from audiolib.core import SR
from sfxlib import core, finish, measure, prims


def _sound(audio, **kw):
    base = dict(id="t_01", group="t", category="ui", role="ui", audio=audio, description="test", tags=["test"])
    base.update(kw)
    return core.Sound(**base)


class Finishing(unittest.TestCase):
    def test_peak_tail_and_start(self):
        x = prims.strike([(1500, 0.05, 1.0), (300, 0.08, 0.5)], 0.4, 0.0002) * 0.3
        y = finish.finalize(_sound(prims.dual(x)))
        self.assertAlmostEqual(20 * math.log10(float(np.max(np.abs(y)))), core.PEAK_DBFS, places=6)
        self.assertEqual(float(np.max(np.abs(y[:, -1]))), 0.0)  # ends at exactly zero
        self.assertLess(float(np.max(np.abs(y[:, 0]))), 1e-3)  # no step at the start
        tail = y[:, -int(0.01 * SR):]
        self.assertLess(20 * math.log10(float(np.sqrt(np.mean(tail**2))) + 1e-30), -60)

    def test_soft_start_removes_a_step(self):
        x = np.ones(4800) * 0.5
        y = finish.finalize(_sound(prims.dual(x), hp_hz=None, lp_hz=None))
        self.assertLess(abs(y[0, 0]), 0.01)

    def test_finishing_does_not_move_a_transient(self):
        x = np.zeros(9600)
        x[3200:] = prims.strike([(2000, 0.02, 1.0)], 0.14, 0.0002)[: 9600 - 3200]
        y = finish.finalize(_sound(prims.dual(x)))
        self.assertLessEqual(abs(measure.transient_index(y) - 3200), 48)  # within 1 ms

    def test_loop_finishing_keeps_the_seam(self):
        n = 48000
        t = np.arange(n) / SR
        x = np.sin(2 * np.pi * 300 * t) * (0.6 + 0.4 * np.sin(2 * np.pi * 2 * t))
        y = finish.finalize(_sound(prims.dual(x), loop=True))
        self.assertEqual(y.shape[1], n)
        jump = abs(y[0, 0] - y[0, -1])
        step = float(np.max(np.abs(np.diff(y[0]))))
        self.assertLessEqual(jump, step * 1.01)  # the wrap is no bigger than any other sample step

    def test_rejects_silence_and_nan(self):
        with self.assertRaises(ValueError):
            finish.finalize(_sound(np.zeros((2, 4800))))
        bad = np.ones((2, 4800))
        bad[0, 10] = np.nan
        with self.assertRaises(ValueError):
            finish.finalize(_sound(bad))


class Measurements(unittest.TestCase):
    def test_momentary_loudness_of_a_sine(self):
        t = np.arange(SR) / SR
        x = 0.1 * np.sin(2 * np.pi * 997 * t)
        lufs, _ = measure.window_loudness_max(prims.dual(x), 0.4)
        # EBU Tech 3341 case 1: a 1 kHz sine of amplitude A in both channels reads 20 log10(A) LUFS
        # (the K-weighting gain at 1 kHz cancels the -0.691 offset)
        self.assertAlmostEqual(lufs, 20 * math.log10(0.1), delta=0.1)

    def test_window_centre_points_at_the_burst(self):
        x = np.zeros(SR)
        k0 = int(0.6 * SR)
        x[k0 : k0 + 2400] = np.sin(2 * np.pi * 1000 * np.arange(2400) / SR)
        _, c = measure.window_loudness_max(prims.dual(x), 0.05)
        self.assertAlmostEqual(c, 0.6 + 0.025, delta=0.003)

    def test_align_peak_to_frame(self):
        n = prims.n_samples(0.8)
        x = prims.noise(n, "align") * prims.passby(n, 0.3123, 0.05, 0.1, 0.0, 0.79)
        y, s = measure.align_peak_to_frame(prims.dual(x), 0.05)
        self.assertTrue(core.on_frame(s))
        self.assertLessEqual(y.shape[1] - n, core.FRAME)
        self.assertAlmostEqual(measure.perceived_peak_s(y, 0.05), s, delta=1.5 / SR)

    def test_harsh_resonance_is_found_and_noise_is_not(self):
        ring = prims.strike([(3200, 0.3, 1.0), (800, 0.05, 0.3)], 0.6, 0.0002)
        self.assertTrue(measure.harsh(measure.resonances(prims.dual(ring))))
        n = prims.n_samples(0.6)
        burst = prims.noise(n, "nb") * prims.ar_env(n, 0.005, 0.4)
        self.assertEqual(measure.harsh(measure.resonances(prims.dual(burst))), [])

    def test_design_tail(self):
        x = prims.strike([(1000, 0.05, 1.0)], 0.3, 0.0002)
        self.assertLess(measure.design_tail_db(x), -100)
        cut = prims.strike([(1000, 2.0, 1.0)], 0.3, 0.0002)
        self.assertGreater(measure.design_tail_db(cut), -20)

    def test_checks_flag_an_off_frame_sync(self):
        x = prims.dual(prims.noise(9600, "c") * prims.ar_env(9600, 0.05, 0.1))
        s = _sound(x, sync="peak", sync_s=0.051)
        m = measure.analyse(finish.finalize(s), s)
        sync = [c for c in measure.checks(m, s) if c["id"] == "syncOnFrame"][0]
        self.assertFalse(sync["pass"])


if __name__ == "__main__":
    unittest.main()
