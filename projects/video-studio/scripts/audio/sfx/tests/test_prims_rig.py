"""Synthesis primitives and Zoo's typing rig."""

import math
import unittest
from itertools import pairwise

import numpy as np

from audiolib.core import SR
from sfxlib import core, prims, rig


def _env_db(x, i):
    return 20 * math.log10(abs(x[i]) + 1e-30)


class Constants(unittest.TestCase):
    def test_frame_is_1600_samples(self):
        self.assertEqual(core.FRAME, 1600)
        self.assertTrue(core.on_frame(10 / 30))
        self.assertTrue(core.on_frame(0.0))
        self.assertFalse(core.on_frame(0.25))  # 7.5 frames

    def test_sound_rejects_unknown_role_and_sync(self):
        with self.assertRaises(ValueError):
            core.Sound("x_01", "x", "ui", "nope", np.zeros(10), "", ["t"])
        with self.assertRaises(ValueError):
            core.Sound("x_01", "x", "ui", "ui", np.zeros(10), "", ["t"], sync="middle")
        with self.assertRaises(ValueError):
            core.Sound("x_01", "x", "ui", "ui", np.zeros(10), "", [])


class Modal(unittest.TestCase):
    def test_mode_frequency_decay_and_clean_start(self):
        x = prims.modal([(1000.0, 0.2, 1.0)], 0.5)
        self.assertEqual(x[0], 0.0)  # starts at phase 0: no step
        spec = np.abs(np.fft.rfft(x * np.hanning(x.size), 1 << 18))
        f = np.fft.rfftfreq(1 << 18, 1 / SR)[int(np.argmax(spec))]
        self.assertAlmostEqual(f, 1000.0, delta=0.5)
        # -60 dB at t60: compare the envelope (peak of a cycle) at 0 and at t60
        cyc = SR // 1000
        a0 = np.max(np.abs(x[:cyc]))
        k = int(0.2 * SR)
        a1 = np.max(np.abs(x[k : k + cyc]))
        self.assertAlmostEqual(20 * math.log10(a1 / a0), -60.0, delta=0.6)

    def test_modes_above_nyquist_guard_are_dropped(self):
        x = prims.modal([(23000.0, 0.1, 1.0)], 0.05)
        self.assertEqual(float(np.max(np.abs(x))), 0.0)

    def test_hann_pulse_unit_area_and_softer_when_wider(self):
        for w in (0.0001, 0.0005):
            self.assertAlmostEqual(float(prims.hann_pulse(w).sum()), 1.0, places=9)
        fr = np.fft.rfftfreq(4096, 1 / SR)
        k = int(np.argmin(np.abs(fr - 4000)))
        narrow = abs(np.fft.rfft(prims.hann_pulse(0.0001), 4096)[k])
        wide = abs(np.fft.rfft(prims.hann_pulse(0.0005), 4096)[k])
        self.assertGreater(narrow, 3 * wide)  # a harder contact keeps more top end

    def test_jitter_modes_is_deterministic_and_bounded(self):
        modes = [(1000, 0.02, 1.0), (2000, 0.01, 0.5)]
        a = prims.jitter_modes(modes, "seed", freq_pct=5, t60_pct=10, amp_db=2)
        self.assertEqual(a, prims.jitter_modes(modes, "seed", freq_pct=5, t60_pct=10, amp_db=2))
        for (f0, t0, a0), (f1, t1, a1) in zip(modes, a, strict=True):
            self.assertLessEqual(abs(f1 / f0 - 1), 0.05 + 1e-12)
            self.assertLessEqual(abs(t1 / t0 - 1), 0.10 + 1e-12)
            self.assertLessEqual(abs(20 * math.log10(a1 / a0)), 2 + 1e-9)


class Envelopes(unittest.TestCase):
    def test_ar_env_starts_at_zero_and_reaches_minus_60(self):
        e = prims.ar_env(prims.n_samples(1.0), 0.01, 0.5)
        self.assertEqual(e[0], 0.0)
        self.assertAlmostEqual(float(e[prims.n_samples(0.01)]), 1.0, places=3)
        self.assertAlmostEqual(_env_db(e, prims.n_samples(0.51)), -60.0, delta=0.2)

    def test_passby_peaks_at_tp_and_is_zero_at_the_edges(self):
        n = prims.n_samples(1.0)
        a = prims.passby(n, 0.4, 0.1, 0.2, 0.0, 0.99)
        self.assertEqual(int(np.argmax(a)), prims.n_samples(0.4))
        self.assertAlmostEqual(float(a.max()), 1.0, places=9)
        self.assertLess(a[0], 1e-9)
        self.assertLess(a[prims.n_samples(0.99)], 1e-6)
        self.assertTrue(np.all(np.diff(a[: prims.n_samples(0.4)]) >= -1e-12))  # rises to the pass

    def test_bezier_ease_matches_the_parametric_curve(self):
        x1, y1, x2, y2 = 0.45, 0.0, 0.25, 1.0
        ease = prims.bezier_ease(x1, y1, x2, y2)
        s = np.linspace(0, 1, 200001)
        bx = 3 * (1 - s) ** 2 * s * x1 + 3 * (1 - s) * s * s * x2 + s**3
        by = 3 * (1 - s) ** 2 * s * y1 + 3 * (1 - s) * s * s * y2 + s**3
        for t in (0.0, 0.1, 0.25, 0.5, 0.75, 0.9, 1.0):
            self.assertAlmostEqual(float(ease(t)), float(np.interp(t, bx, by)), places=5)
        u = np.linspace(0, 1, 1001)
        self.assertTrue(np.all(np.diff(ease(u)) >= -1e-12))

    def test_slip_times_follow_the_rate(self):
        t = prims.slip_times(2.0, 100.0, "s", jitter=0.3)
        self.assertAlmostEqual(float(np.mean(np.diff(t))), 0.01, delta=0.0015)
        self.assertTrue(np.all(np.diff(t) > 0))

    def test_pan_is_constant_power(self):
        x = np.ones(5)
        st = prims.pan(x, np.linspace(-1, 1, 5))
        self.assertTrue(np.allclose(st[0] ** 2 + st[1] ** 2, 1.0))
        self.assertAlmostEqual(float(st[0, 2]), float(st[1, 2]))


class Rig(unittest.TestCase):
    """The copy of src/characters/zoo/views/Typing.tsx fingerLift (read 2026-11-24)."""

    def test_finger_lift_spot_values(self):
        # near hand (0), finger 0: period 9, phase 0 -> rises on frames 1..3, lands on 4
        self.assertEqual(rig.finger_lift(0, 0, 0), 0.0)
        self.assertAlmostEqual(rig.finger_lift(2, 0, 0), 16.0)
        self.assertAlmostEqual(rig.finger_lift(1, 0, 0), math.sin(math.pi / 4) * 16)
        self.assertEqual(rig.finger_lift(4, 0, 0), 0.0)
        # far hand (1): period 12 for every finger
        self.assertEqual([9 + ((f * 5 + 1 * 3) % 5) for f in range(4)], [12, 12, 12, 12])

    def test_strike_frames_repeat_every_36(self):
        res = rig.strike_residues()
        self.assertEqual(res, [1, 3, 4, 5, 6, 8, 10, 13, 15, 17, 19, 20, 22, 24, 26, 27, 28, 29, 31, 32, 33, 34, 35])
        for f in range(200):
            self.assertEqual(bool(rig.strikes_at(f)), bool(rig.strikes_at(f + 36)))

    def test_typing_plan_lands_on_strike_frames_with_a_human_rhythm(self):
        for seed in ("a", "b", "c"):
            plan = rig.typing_plan(seed, 6, rig_phase=1, enter_at_end=True)
            frames = [e["frame"] for e in plan]
            self.assertEqual(frames[0], 0)
            self.assertTrue(all(b - a >= 2 for a, b in pairwise(frames)))
            self.assertTrue(all(rig.is_strike(f, 1) for f in frames))
            kinds = [e["key"] for e in plan]
            self.assertEqual(kinds.count("space"), 5)
            self.assertEqual(kinds[-1], "enter")
            iki = np.diff(frames)
            self.assertTrue(3.0 <= float(np.median(iki)) <= 6.0)
            self.assertEqual(plan, rig.typing_plan(seed, 6, rig_phase=1, enter_at_end=True))  # deterministic

    def test_without_rig_every_key_is_still_on_a_frame(self):
        plan = rig.typing_plan("free", 4, rig_phase=None)
        self.assertTrue(all(isinstance(e["frame"], int) for e in plan))


if __name__ == "__main__":
    unittest.main()
