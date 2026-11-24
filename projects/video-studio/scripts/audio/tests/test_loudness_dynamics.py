import math
import tempfile
import unittest
from pathlib import Path

import numpy as np

from audiolib import analysis, dynamics, io, loudness
from audiolib.core import SR

from .helpers import have_ffmpeg, sine, stereo


class LoudnessTest(unittest.TestCase):
    def test_ebu_tech3341_sines(self):
        # case 1 and 2: stereo 1 kHz sine at -23 / -33 dBFS reads -23 / -33 LUFS (+-0.1)
        for level in (-23.0, -33.0):
            x = stereo(sine(1000, 20.0, 10 ** (level / 20)))
            self.assertAlmostEqual(loudness.integrated(x), level, delta=0.1)
            st = loudness.short_term(x)
            self.assertAlmostEqual(float(np.median(st)), level, delta=0.1)
            self.assertAlmostEqual(float(np.median(loudness.momentary(x))), level, delta=0.1)

    def test_gating_ignores_silence(self):
        tone = stereo(sine(1000, 10.0, 10 ** (-20 / 20)))
        with_gap = np.concatenate([tone, np.zeros((2, 10 * SR)), tone], axis=1)
        self.assertAlmostEqual(loudness.integrated(with_gap), -20.0, delta=0.1)
        self.assertEqual(loudness.integrated(np.zeros((2, SR))), float("-inf"))

    def test_relative_gate(self):
        # EBU Tech 3341 case 3: -36 dBFS 10 s, -23 dBFS 60 s, -36 dBFS 10 s -> -23.0 (+-0.1): the
        # -36 parts fall under the relative gate (mean - 10 LU)
        a = stereo(sine(1000, 10.0, 10 ** (-36 / 20)))
        b = stereo(sine(1000, 60.0, 10 ** (-23 / 20)))
        self.assertAlmostEqual(loudness.integrated(np.concatenate([a, b, a], axis=1)), -23.0, delta=0.1)
        # with only 10 s at -23 the mean drops and the -36 parts pass the gate, as the standard says
        b10 = stereo(sine(1000, 10.0, 10 ** (-23 / 20)))
        self.assertLess(loudness.integrated(np.concatenate([a, b10, a], axis=1)), -26.0)

    def test_lra_of_two_levels(self):
        # EBU 3342 case 1: 20 s at -20 then 20 s at -30 dBFS -> LRA 10 LU (+-1)
        a = stereo(sine(1000, 20.0, 10 ** (-20 / 20)))
        b = stereo(sine(1000, 20.0, 10 ** (-30 / 20)))
        self.assertAlmostEqual(loudness.loudness_range(np.concatenate([a, b], axis=1)), 10.0, delta=1.0)

    def test_true_peak_sees_intersample_overs(self):
        t = np.arange(SR) / SR
        x = 0.9 * np.sin(2 * math.pi * 12000 * t + math.pi / 4)  # samples land 3 dB under the peak
        x = stereo(x * np.minimum(1, np.minimum(t, t[::-1]) / 0.05))
        self.assertLess(loudness.sample_peak(x), -3.5)
        self.assertAlmostEqual(loudness.true_peak(x), 20 * math.log10(0.9), delta=0.1)

    def test_other_rates_use_the_analog_prototype(self):
        x = stereo(sine(1000, 10.0, 10 ** (-23 / 20), sr=44100))
        self.assertAlmostEqual(loudness.integrated(x, 44100), -23.0, delta=0.1)
        k44 = loudness.k_weighting_sos(44100)
        self.assertEqual(k44.shape, (2, 6))

    @unittest.skipUnless(have_ffmpeg(), "ffmpeg not installed")
    def test_agrees_with_ffmpeg_ebur128(self):
        rng = np.random.default_rng(5)
        music_like = np.vstack([np.convolve(rng.standard_normal(SR * 12), np.ones(6) / 6, "same"), np.convolve(rng.standard_normal(SR * 12), np.ones(9) / 9, "same")])
        music_like *= (0.6 + 0.4 * np.sin(2 * math.pi * 0.3 * np.arange(SR * 12) / SR)) * 0.25
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "x.wav"
            io.write(p, music_like, subtype="FLOAT")
            eb = analysis.ffmpeg_ebur128(p)
        self.assertAlmostEqual(loudness.integrated(music_like), eb["integrated"], delta=0.1)
        self.assertAlmostEqual(loudness.true_peak(music_like), eb["truePeak"], delta=0.2)
        self.assertAlmostEqual(loudness.loudness_range(music_like), eb["lra"], delta=0.3)


class CompressorTest(unittest.TestCase):
    def test_static_curve_and_knee(self):
        c = dynamics.Compressor(threshold_db=-20, ratio=4, knee_db=0)
        g = c.gain_computer(np.array([-40.0, -20.0, -10.0, 0.0]))
        np.testing.assert_allclose(g, [0.0, 0.0, -7.5, -15.0])
        soft = dynamics.Compressor(threshold_db=-20, ratio=4, knee_db=10).gain_computer(np.array([-26.0, -20.0, -14.0]))
        self.assertEqual(soft[0], 0.0)
        self.assertLess(soft[1], 0.0)
        self.assertAlmostEqual(soft[2], -4.5, places=6)  # above the knee: (6 dB over) * (1/4 - 1)

    def test_steady_state_gain_reduction(self):
        x = stereo(sine(1000, 2.0, 10 ** (-10 / 20)))  # peak -10 dBFS
        y, gr = dynamics.Compressor(threshold_db=-20, ratio=2, attack_ms=5, release_ms=50, knee_db=0).process(x)
        self.assertAlmostEqual(float(np.median(gr[SR:])), -5.0, delta=0.3)
        out_peak = 20 * math.log10(np.max(np.abs(y[:, SR:])))
        self.assertAlmostEqual(out_peak, -15.0, delta=0.4)

    def test_linked_stereo(self):
        x = np.vstack([sine(200, 1.0, 0.9), sine(200, 1.0, 0.05)])
        y, _ = dynamics.Compressor(threshold_db=-20, ratio=4, attack_ms=5, release_ms=50).process(x)
        gl = np.max(np.abs(y[0, SR // 2 :])) / 0.9
        gr = np.max(np.abs(y[1, SR // 2 :])) / 0.05
        self.assertAlmostEqual(20 * math.log10(gl), 20 * math.log10(gr), delta=0.05)

    def test_parallel_mix_and_sidechain_hp(self):
        x = stereo(sine(60, 1.0, 0.9))
        _, gr_full = dynamics.Compressor(threshold_db=-20, ratio=4).process(x)
        _, gr_hp = dynamics.Compressor(threshold_db=-20, ratio=4, sidechain_hp_hz=200).process(x)
        self.assertLess(gr_full[SR // 2 :].mean(), gr_hp[SR // 2 :].mean() - 6)  # the HP sidechain ignores the bass
        y, _ = dynamics.Compressor(threshold_db=-40, ratio=10, mix=0.0).process(x)
        self.assertTrue(np.allclose(y, x))


class LimiterTest(unittest.TestCase):
    def test_true_peak_ceiling_is_held(self):
        rng = np.random.default_rng(1)
        hot = np.vstack([rng.standard_normal(SR * 3), rng.standard_normal(SR * 3)]) * 0.6
        for ceiling in (-1.0, -6.0):
            y, rep = dynamics.limit(hot, ceiling)
            self.assertLessEqual(loudness.true_peak(y), ceiling)
            self.assertLessEqual(rep["truePeak"], ceiling)
            self.assertGreater(rep["grMaxDb"], 3.0)

    def test_quiet_material_passes_untouched(self):
        x = stereo(sine(440, 1.0, 0.1))
        y, rep = dynamics.limit(x, -1.0)
        self.assertEqual(rep["passes"], 0)
        self.assertTrue(np.allclose(y, x))


if __name__ == "__main__":
    unittest.main()
