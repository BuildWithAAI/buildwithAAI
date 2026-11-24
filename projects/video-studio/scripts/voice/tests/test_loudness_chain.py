"""audio._two_pass: the true-peak ceiling holds (2026-11-24: on short, hard-pushed clips ffmpeg's loudnorm dynamic mode let
-0.27 dBTP (es) and -0.53 dBTP (zh) through; the e2e suite caught it). ffmpeg is faked, so this runs with the stdlib only.
The real limiter chain was measured on a clip at +0.11 dBTP: -1.23 dBTP, 0.28 LU quieter, same samples and alignment."""

import os
import tempfile
import unittest
from unittest import mock

from voicelib import audio


class TwoPass(unittest.TestCase):
    def run_chain(self, results: list[tuple[float, float]]):
        """results: (integrated LUFS, true peak dBTP) that each successive measure() of the output reports."""
        calls: list[list[str]] = []
        seq = iter(results)

        def fake_ffmpeg(args):
            calls.append(args)
            with open(args[-1], "wb") as fh:  # every ffmpeg call writes its last argument
                fh.write(b"")
            return mock.Mock(stderr="")

        def fake_measure(_path):
            i, tp = next(seq)
            return {"input_i": str(i), "input_tp": str(tp)}

        first = {"input_i": "-16.6", "input_tp": "-1.9", "input_lra": "10.8", "input_thresh": "-27.1", "target_offset": "1.0"}
        with tempfile.TemporaryDirectory() as d, mock.patch.object(audio, "_ffmpeg", fake_ffmpeg), mock.patch.object(
            audio, "_loudnorm_json", lambda _s: {"normalization_type": "dynamic"}
        ), mock.patch.object(audio, "measure", fake_measure):
            out = audio._two_pass(os.path.join(d, "in.wav"), os.path.join(d, "out.wav"), 24000, first)
        return out, calls

    def test_an_overshoot_goes_through_the_true_peak_limiter(self):
        out, calls = self.run_chain([(-14.1, -0.27), (-14.3, -1.23)])
        self.assertTrue(out["truePeakLimited"])
        self.assertIn("alimiter", calls[-1][3])
        self.assertIn(f"aresample={audio.TP_LIMITER_RATE}", calls[-1][3])
        self.assertNotIn("trimDb", out)
        self.assertLessEqual(float(out["result"]["input_tp"]), audio.TARGET_TP)
        self.assertAlmostEqual(float(out["result"]["input_i"]), audio.TARGET_I, delta=audio.WARN_LU)

    def test_the_ceiling_holds_even_when_the_limiter_cannot(self):
        out, calls = self.run_chain([(-14.0, -0.3), (-14.1, -0.6), (-14.8, -1.2)])
        self.assertTrue(out["truePeakLimited"])
        self.assertAlmostEqual(out["trimDb"], audio.LIMIT_TP - (-0.6), places=2)
        self.assertIn("volume=", calls[-1][3])
        self.assertLessEqual(float(out["result"]["input_tp"]), audio.TARGET_TP)

    def test_a_clean_pass_is_untouched(self):
        out, calls = self.run_chain([(-14.05, -1.3)])
        self.assertEqual(len(calls), 1)
        self.assertNotIn("truePeakLimited", out)
        self.assertNotIn("trimDb", out)

    def test_the_limiter_chain_keeps_the_rate(self):
        chain = audio.true_peak_limiter(24000)
        self.assertTrue(chain.startswith(f"aresample={audio.TP_LIMITER_RATE},alimiter="))
        self.assertTrue(chain.endswith(",aresample=24000"))
        self.assertIn("latency=1", chain)  # look-ahead compensated: samples keep their positions


if __name__ == "__main__":
    unittest.main()
