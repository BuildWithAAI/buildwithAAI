import math
import tempfile
import unittest
from pathlib import Path

import numpy as np

from audiolib import dsp, io
from audiolib.core import SR, as_channels, as_stereo, db_to_lin, lin_to_db, midi_to_hz, mix_into, note_name, note_number, pad_to, seed_from

from .helpers import cents, gain_at, partial_hz, sine, stereo


class CoreTest(unittest.TestCase):
    def test_note_names(self):
        self.assertEqual(note_number("C4"), 60)
        self.assertEqual(note_number("A4"), 69)
        self.assertEqual(note_number("F#2"), 42)
        self.assertEqual(note_number("Bb3"), 58)
        self.assertEqual(note_number("C-1"), 0)
        self.assertEqual(note_number(64), 64)
        self.assertEqual(note_name(61), "C#4")
        for bad in ("H4", "C", "C#x", "G#9"):
            with self.assertRaises(ValueError):
                note_number(bad)
        self.assertAlmostEqual(float(midi_to_hz(69)), 440.0)

    def test_db_and_layout(self):
        self.assertAlmostEqual(float(db_to_lin(-6.0206)), 0.5, places=4)
        self.assertAlmostEqual(float(lin_to_db(0.1)), -20.0, places=6)
        self.assertEqual(as_channels(np.zeros(10)).shape, (1, 10))
        self.assertEqual(as_channels(np.zeros((100, 2))).shape, (2, 100))  # soundfile layout transposed
        self.assertEqual(as_stereo(np.ones(5)).shape, (2, 5))
        self.assertEqual(pad_to(np.ones((2, 5)), 8).shape, (2, 8))
        self.assertEqual(pad_to(np.ones((2, 5)), 3).shape, (2, 3))

    def test_mix_into_clips_to_destination(self):
        dst = np.zeros((2, 10))
        mix_into(dst, np.ones((2, 6)), offset=7)
        self.assertEqual(dst[0].tolist(), [0] * 7 + [1, 1, 1])
        dst = np.zeros((2, 4))
        mix_into(dst, np.ones((1, 6)), offset=-3, gain=2.0)
        self.assertEqual(dst[1].tolist(), [2, 2, 2, 0])

    def test_seed_is_stable(self):
        self.assertEqual(seed_from("a", 1), seed_from("a", 1))
        self.assertNotEqual(seed_from("a", 1), seed_from("a", 2))


class IoTest(unittest.TestCase):
    def test_24bit_round_trip_within_one_lsb(self):
        x = stereo(sine(997, 0.5, 0.7))
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "t.wav"
            io.write(p, x)
            info = io.info(p)
            self.assertEqual((info["samplerate"], info["channels"], info["subtype"]), (SR, 2, "PCM_24"))
            y = io.read(p)
        self.assertLess(np.max(np.abs(y - x)), 2.0 / 2**23)

    def test_write_refuses_overs_and_nan(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(ValueError):
                io.write(Path(d) / "o.wav", np.full((2, 100), 1.2))
            with self.assertRaises(ValueError):
                io.write(Path(d) / "n.wav", np.full((2, 100), np.nan))

    def test_dither_keeps_digital_silence_silent(self):
        x = np.zeros((2, 4096))
        x[:, 2048:] = 0.25
        q = io.quantize(x, 16, dither=True, seed=1)
        self.assertTrue(np.all(q[:, :2048] == 0.0))
        self.assertGreater(np.std(q[:, 2048:] - 0.25), 0)

    def test_resample_ratio_pitch_is_exact(self):
        x = sine(440.0, 3.0)
        up = io.resample_ratio(x, 2 ** (1 / 12))[0]
        self.assertAlmostEqual(cents(partial_hz(up, 466.16), 466.1638), 0.0, delta=0.05)
        down = io.resample_ratio(x, 2 ** (-7 / 12))[0]
        self.assertAlmostEqual(cents(partial_hz(down, 293.66), 293.6648), 0.0, delta=0.05)

    def test_rate_conversion_length_and_level(self):
        x = sine(1000, 1.0, 0.5, sr=44100)
        y = io.resample(x, 44100, 48000)[0]
        self.assertEqual(y.shape[0], 48000)
        mid = y[4800:-4800]
        self.assertAlmostEqual(np.max(np.abs(mid)), 0.5, delta=0.005)


class DspTest(unittest.TestCase):
    def test_biquad_responses(self):
        f = [100.0, 1000.0, 2000.0, 8000.0]
        lp = dsp.sos_response_db(dsp.biquad("lowpass", 1000), f)
        self.assertAlmostEqual(lp[1], -3.01, delta=0.05)
        self.assertLess(lp[3], -30)
        pk = dsp.sos_response_db(dsp.biquad("peak", 2000, q=1.0, gain_db=6.0), f)
        self.assertAlmostEqual(pk[2], 6.0, delta=0.01)
        self.assertLess(abs(pk[0]), 0.1)
        ls = dsp.sos_response_db(dsp.biquad("lowshelf", 200, gain_db=-4.0), [20.0, 10000.0])
        self.assertAlmostEqual(ls[0], -4.0, delta=0.1)
        self.assertAlmostEqual(ls[1], 0.0, delta=0.05)
        hp4 = dsp.sos_response_db(dsp.butter("highpass", 40, 4), [10.0, 40.0, 400.0])
        self.assertAlmostEqual(hp4[1], -3.01, delta=0.05)
        self.assertLess(hp4[0], -45)

    def test_linkwitz_riley_bands_sum_flat(self):
        f = np.geomspace(20, 20000, 40)
        lo = dsp.linkwitz_riley("lowpass", 500)
        hi = dsp.linkwitz_riley("highpass", 500)
        from scipy.signal import sosfreqz

        _, hl = sosfreqz(lo, worN=f, fs=SR)
        _, hh = sosfreqz(hi, worN=f, fs=SR)
        self.assertLess(np.max(np.abs(20 * np.log10(np.abs(hl + hh)))), 0.01)
        self.assertAlmostEqual(dsp.sos_response_db(lo, [500.0])[0], -6.02, delta=0.05)

    def test_eq_applies_bands(self):
        x = sine(3000, 1.0)
        y = dsp.eq(x, [{"kind": "peak", "f": 3000, "q": 1.0, "db": -6.0}])[0]
        self.assertAlmostEqual(gain_at(x, y, 3000), -6.0, delta=0.2)

    def test_pan_law_and_balance(self):
        x = np.ones(10)
        c = dsp.pan_mono(x, 0.0)
        self.assertAlmostEqual(c[0, 0], math.cos(math.pi / 4))
        left = dsp.pan_mono(x, -1.0)
        self.assertAlmostEqual(left[1, 0], 0.0, places=12)
        b = dsp.balance(np.ones((2, 10)), 0.0)
        self.assertAlmostEqual(b[0, 0], 1.0)

    def test_width_keeps_mid_and_monos_the_bass(self):
        rng = np.random.default_rng(0)
        x = rng.standard_normal((2, SR))
        w = dsp.width(x, 0.0, None)
        self.assertTrue(np.allclose(w[0], w[1]))
        self.assertTrue(np.allclose(w[0], 0.5 * (x[0] + x[1])))
        low = np.vstack([sine(50, 2.0), -sine(50, 2.0)])  # pure side at 50 Hz
        m = dsp.width(low, 1.5, bass_mono_hz=150)
        self.assertLess(np.max(np.abs(m[:, SR // 2 : -SR // 2])), 0.01)

    def test_fades_and_loop_crossfade(self):
        x = np.ones((1, SR))
        f = dsp.fade(x, 0.1, 0.2)
        self.assertLess(f[0, 0], 0.01)
        self.assertLess(f[0, -1], 0.01)
        self.assertEqual(f[0, SR // 2], 1.0)
        for curve in ("linear", "sine", "scurve", "exp"):
            g = dsp.fade_curve(np.array([0.0, 1.0]), curve)
            self.assertAlmostEqual(g[0], 0.0, places=6)
            self.assertAlmostEqual(g[1], 1.0, places=6)
        noise = np.random.default_rng(2).standard_normal((2, 3 * SR)) * 0.1
        looped = dsp.crossfade_loop(noise, 0.25)
        self.assertEqual(looped.shape[1], int(2.75 * SR))
        # the wrap point is continuous: the last sample of the loop is followed by its first
        from audiolib import analysis

        self.assertLess(analysis.loop_seam(looped)["clickRatio"], 2.0)

    def test_saturation_is_unity_for_small_signals_and_adds_harmonics(self):
        small = sine(200, 1.0, 0.001)
        for kind in ("tanh", "cubic", "asym"):
            out = dsp.saturate(small, 12.0, kind)[0]
            self.assertAlmostEqual(gain_at(small, out, 200), 0.0, delta=0.3, msg=kind)
        hot = sine(200, 1.0, 0.8)

        def harmonic_db(y, k):
            w = np.hanning(len(y))
            spec = np.abs(np.fft.rfft(y * w))
            fr = np.fft.rfftfreq(len(y), 1 / SR)
            return 20 * math.log10(spec[np.argmin(np.abs(fr - 200 * k))] / spec[np.argmin(np.abs(fr - 200))])

        odd = dsp.saturate(hot, 12.0, "tanh")[0]
        self.assertGreater(harmonic_db(odd, 3), -30)  # tanh: strong 3rd harmonic
        self.assertLess(harmonic_db(odd, 2), -80)  # symmetric curve: no 2nd
        even = dsp.saturate(hot, 12.0, "asym")[0]
        self.assertGreater(harmonic_db(even, 2), -40)  # asymmetric curve: even harmonics

    def test_saturation_aliasing_is_low(self):
        x = sine(5000, 1.0, 0.8)
        for drive in (12.0, 20.0):
            y = dsp.saturate(x, drive, "tanh")[0]
            w = np.blackman(len(y))
            spec = np.abs(np.fft.rfft(y * w))
            fr = np.fft.rfftfreq(len(y), 1 / SR)
            harm = np.zeros_like(spec, bool)
            for k in range(1, 5):
                harm |= np.abs(fr - 5000 * k) < 30
            audible = (~harm) & (fr > 100) & (fr < 20000)
            full = (~harm) & (fr > 100)  # up to 24 kHz: the 25 kHz harmonic folds to 23 kHz, inaudible
            self.assertLess(20 * math.log10(spec[audible].max() / spec.max()), -100, msg=f"drive {drive}")
            self.assertLess(20 * math.log10(spec[full].max() / spec.max()), -60, msg=f"drive {drive}")

    def test_fractional_delay(self):
        x = np.arange(10, dtype=float)
        y = dsp.fractional_delay(x, 1.5)
        self.assertAlmostEqual(y[5], 3.5)
        self.assertEqual(y[0], 0.0)


if __name__ == "__main__":
    unittest.main()
