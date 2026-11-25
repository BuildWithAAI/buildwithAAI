"""Tests for the AudioDemo's master and measurement tools (stdlib unittest; run with the audio engine's venv).

    .venv-audio/bin/python -m unittest discover -s src/audio/tools/tests -t src/audio/tools
"""

from __future__ import annotations

import shutil
import sys
import tempfile
import unittest
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[1]
STUDIO = TOOLS.parents[2]
sys.path.insert(0, str(TOOLS))
sys.path.insert(0, str(STUDIO / "scripts" / "audio"))

import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402

import master_mix  # noqa: E402
import measure_mix  # noqa: E402
from audiolib import loudness  # noqa: E402

SR = 48000


def noise(n: int, amp: float, seed: int) -> np.ndarray:
    return np.random.default_rng(seed).uniform(-amp, amp, n)


def programme(seconds: float = 12.0) -> np.ndarray:
    """A stereo test programme: steady noise with sharp transients (what a limiter has to catch)."""
    n = int(seconds * SR)
    x = np.vstack([noise(n, 0.05, 1), noise(n, 0.05, 2)])
    for k in range(1, int(seconds)):
        i = k * SR
        x[:, i:i + 240] += np.hanning(240) * 0.6  # 5 ms clicks well over the body
    return x


class MasterTests(unittest.TestCase):
    def test_hits_the_target_and_holds_the_ceiling(self):
        x = programme()
        y, rep = master_mix.master_audio(x, -14.0, -1.5)
        self.assertAlmostEqual(loudness.integrated(y), -14.0, delta=0.05)
        self.assertLessEqual(loudness.true_peak(y), -1.5 + 0.05)
        self.assertGreater(rep["limiter"]["grMaxDb"], 1.0)  # the clicks were limited, not the body
        self.assertAlmostEqual(rep["integratedLufs"], -14.0, delta=0.051)  # rounded to 0.01 in the report

    def test_a_quiet_clean_programme_only_gets_gain(self):
        n = 10 * SR
        t = np.arange(n) / SR
        x = 0.02 * np.vstack([np.sin(2 * np.pi * 997 * t), np.sin(2 * np.pi * 997 * t)])
        y, rep = master_mix.master_audio(x, -14.0, -1.5)
        self.assertAlmostEqual(loudness.integrated(y), -14.0, delta=0.05)
        g = rep["gainDb"]
        np.testing.assert_allclose(y, x * 10 ** (g / 20), atol=2e-3)  # no limiting on a sine 10+ dB under the ceiling

    def test_subsonic_filter_removes_dc_and_keeps_the_bass(self):
        t = np.arange(4 * SR) / SR
        bass = 0.3 * np.sin(2 * np.pi * 36.71 * t)  # D1, the lowest bass note in the music package
        on = (t > 1.0) & (t < 3.0)
        x = np.vstack([bass + 0.17 * on] * 2)  # a DC step while "speech" plays, like the narration
        y = master_mix.subsonic(x)
        seg = slice(int(2.0 * SR), int(2.9 * SR))  # well after the DC step: the filter has settled
        self.assertLess(abs(float(y[0, seg].mean())), 2e-3)
        kept = np.sqrt(np.mean(y[0, int(3.2 * SR):int(3.9 * SR)] ** 2)) / np.sqrt(np.mean(bass[int(3.2 * SR):int(3.9 * SR)] ** 2))
        self.assertAlmostEqual(20 * np.log10(kept), -0.37, delta=0.1)  # analog 2nd-order Butterworth at 20 Hz: -0.37 dB at 36.7 Hz
        np.testing.assert_array_equal(master_mix.subsonic(x, 0), x)

    def test_chunked_meters_equal_the_engine_meters(self):
        # 25 s with clicks that straddle the 10 s chunk boundaries: the chunked meters must agree with audiolib's
        x = programme(25.0) * 0.5
        for edge in (10 * SR - 120, 20 * SR - 5):
            x[:, edge:edge + 240] += np.hanning(240) * 0.4
        self.assertAlmostEqual(master_mix.integrated_lufs(x), loudness.integrated(x), delta=1e-6)
        self.assertAlmostEqual(master_mix.true_peak_dbtp(x), loudness.true_peak(x), delta=1e-6)
        self.assertAlmostEqual(master_mix.integrated_lufs(x[:, : 2 * SR]), loudness.integrated(x[:, : 2 * SR]), delta=1e-6)
        from audiolib.dynamics import limit as engine_limit

        ours, rep = master_mix.limit(x * 4, -1.5, release_ms=80.0)
        theirs, rep2 = engine_limit(x * 4, -1.5, release_ms=80.0)
        self.assertLess(float(np.abs(ours - theirs).max()), 1e-5)
        self.assertEqual({k: rep[k] for k in ("passes", "grMaxDb", "grOver1dBPct")}, {k: rep2[k] for k in ("passes", "grMaxDb", "grOver1dBPct")})
        self.assertAlmostEqual(rep["truePeak"], rep2["truePeak"], delta=0.002)

    def test_refuses_silence(self):
        with self.assertRaises(ValueError):
            master_mix.master_audio(np.zeros((2, SR)), -14.0, -1.5)


class AlignmentTests(unittest.TestCase):
    def test_finds_a_reference_at_its_exact_sample(self):
        mono = noise(SR, 0.01, 3)
        ref = noise(4000, 0.5, 4)
        for true_lag in (-37, 0, 1, 211):
            m = mono.copy()
            m[20000 + true_lag:20000 + true_lag + ref.size] += ref
            self.assertEqual(measure_mix.align_offset(m, ref, 20000, 480), true_lag)
        self.assertIsNone(measure_mix.align_offset(mono, np.zeros(100), 100, 10))

    def test_runs_and_speech_mask(self):
        mask = np.array([0, 1, 1, 0, 0, 1, 0, 1, 1, 1], dtype=bool)
        self.assertEqual(measure_mix._runs(mask), [(1, 3), (5, 6), (7, 10)])
        plan = {"bed": {"speech": [{"start": 0.5, "end": 1.0}]}}
        m = measure_mix.speech_mask(plan, 2 * SR)
        self.assertEqual(int(m.sum()), SR // 2)
        self.assertTrue(m[int(0.75 * SR)] and not m[int(1.25 * SR)])


class VoiceOnTopTests(unittest.TestCase):
    def setUp(self):
        n = 6 * SR
        self.plan = {"bed": {"speech": [{"start": 1.0, "end": 2.5}, {"start": 3.0, "end": 5.0}]}}
        act = measure_mix.speech_mask(self.plan, n)
        v = noise(n, 0.3, 5) * act  # "speech": broadband, only where the plan says
        self.voice = np.vstack([v, v])
        self.n = n

    def test_a_bed_20_db_under_the_voice_reads_about_20_lu_under_it(self):
        r = noise(self.n, 0.03, 6)
        rest = np.vstack([r, r])
        res = measure_mix.voice_on_top(self.voice, rest, self.plan)
        self.assertAlmostEqual(res["voiceOverRestLu"], 20.0, delta=0.5)
        self.assertGreater(res["index"], 0.9)
        self.assertEqual(len(res["phrases"]), 2)

    def test_a_louder_bed_lowers_the_index(self):
        quiet = np.vstack([noise(self.n, 0.03, 6)] * 2)
        loud = np.vstack([noise(self.n, 0.3, 6)] * 2)
        a = measure_mix.voice_on_top(self.voice, quiet, self.plan)["index"]
        b = measure_mix.voice_on_top(self.voice, loud, self.plan)["index"]
        self.assertLess(b, a - 0.2)


@unittest.skipUnless(shutil.which("ffmpeg"), "ffmpeg not installed")
class MeterAgreementTests(unittest.TestCase):
    def test_our_meter_and_ffmpeg_ebur128_agree(self):
        x = programme(8.0) * 0.5
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "x.wav"
            sf.write(str(p), x.T, SR, subtype="FLOAT")
            ff = measure_mix.ffmpeg_ebur128(p)
            ours = measure_mix.level_summary(x)
        self.assertAlmostEqual(ff["integratedLufs"], ours["integratedLufs"], delta=0.1)
        self.assertAlmostEqual(ff["truePeakDbtp"], ours["truePeakDbtp"], delta=0.2)


@unittest.skipUnless(shutil.which("ffmpeg"), "ffmpeg not installed")
class AudioOnlyMasterTests(unittest.TestCase):
    """Added 2026-11-25: audio-only delivery (a dub's audio track) and the platform re-encode check."""

    def test_audio_only_wav_hits_the_target_and_reports_the_platform_re_encodes(self):
        x = programme(10.0) * 0.3
        with tempfile.TemporaryDirectory() as td:
            src, out, rep = Path(td) / "mix.wav", Path(td) / "track.wav", Path(td) / "master.json"
            sf.write(str(src), x.T, SR, subtype="PCM_24")
            code = master_mix.main(["--wav", str(src), "--out", str(out), "--report", str(rep)])
            self.assertEqual(code, 0)
            y, sr = sf.read(str(out), always_2d=True, dtype="float64")
            report = __import__("json").loads(rep.read_text())
        self.assertEqual(sr, SR)
        self.assertAlmostEqual(loudness.integrated(y.T), -14.0, delta=0.1)
        self.assertTrue(report["audioOnly"])
        streams = report["rounds"][-1]["streams"]
        self.assertIn("aac128", streams)
        self.assertIn("opus128", streams)
        for v in streams.values():
            if "truePeakDbtp" in v:
                self.assertLessEqual(v["truePeakDbtp"], master_mix.STREAM_FAIL_DBTP)

    def test_audio_only_m4a_is_aac_at_the_target(self):
        from scipy.signal import butter, sosfiltfilt

        # band-limited like speech and music: white noise to 24 kHz would lose about 1.4 LU to the encoder's 18 kHz cutoff
        x = sosfiltfilt(butter(8, 12000, fs=SR, output="sos"), programme(6.0) * 0.3, axis=1)
        with tempfile.TemporaryDirectory() as td:
            src, out, rep = Path(td) / "mix.wav", Path(td) / "track.m4a", Path(td) / "master.json"
            sf.write(str(src), x.T, SR, subtype="PCM_24")
            code = master_mix.main(["--wav", str(src), "--out", str(out), "--report", str(rep), "--no-stream-check"])
            self.assertEqual(code, 0)
            info = __import__("subprocess").run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_name,sample_rate,channels", "-of", "csv=p=0", str(out)],
                                                capture_output=True, text=True, check=True).stdout.strip()
            report = __import__("json").loads(rep.read_text())
        self.assertEqual(info, "aac,48000,2")
        self.assertAlmostEqual(report["rounds"][-1]["delivered"]["integratedLufs"], -14.0, delta=0.15)
        self.assertLessEqual(report["rounds"][-1]["delivered"]["truePeakDbtp"], -1.0)

    def test_audio_only_refuses_a_video_extension(self):
        with tempfile.TemporaryDirectory() as td:
            src = Path(td) / "mix.wav"
            sf.write(str(src), programme(2.0).T * 0.3, SR, subtype="PCM_24")
            self.assertEqual(master_mix.main(["--wav", str(src), "--out", str(Path(td) / "x.mp4")]), 2)


class SectionLoudnessTests(unittest.TestCase):
    def test_measures_each_section_on_its_own(self):
        a = 0.1 * np.sin(2 * np.pi * 997 * np.arange(4 * SR) / SR)
        mix = np.vstack([np.concatenate([a, a * 0.1])] * 2)
        plan = {"fps": 30, "sections": [{"id": "loud", "from": 0, "to": 120}, {"id": "quiet", "from": 120, "to": 240}]}
        out = {s["id"]: s for s in measure_mix.section_loudness(mix, plan)}
        self.assertAlmostEqual(out["loud"]["integratedLufs"] - out["quiet"]["integratedLufs"], 20.0, delta=0.1)


if __name__ == "__main__":
    unittest.main()
