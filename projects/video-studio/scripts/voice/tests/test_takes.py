"""Take finishing (voicelib/takes.py): deterministic pauses from token durations, fades at every silence edge,
the 47 ms timing-lag correction and the leading pad. numpy is needed for finish(); those tests skip without it."""

import math
import random
import unittest

from voicelib import takes

try:
    import numpy as np  # noqa: F401

    HAVE_NUMPY = True
except ImportError:  # the stdlib-only run
    HAVE_NUMPY = False

SR = 24000


def kokoro_like(text: str, seed: int, sr: int = SR):
    """An untrimmed Kokoro-like take: a 300 ms pad, then each character's token; phones are noisy tones, marks and
    spaces a residual about 38 dB down (what made kokoro-onnx's spliced zeros tick). Returns (audio, tokens)."""
    import numpy as np

    rng = np.random.default_rng(seed)
    dur = {".": 0.075, ",": 0.05, " ": 0.05, "?": 0.05}
    tokens, t = [], 0.3
    pieces = [rng.normal(0, 0.0005, int(0.3 * sr))]
    for ch in text:
        d = dur.get(ch, 0.08)
        n = int(round(d * sr))
        if ch in ".,? ":
            pieces.append(rng.normal(0, 0.012, n))  # about -38 dBFS of residual
        else:
            k = np.arange(n)
            pieces.append(0.4 * np.sin(2 * math.pi * 180 * k / sr) + rng.normal(0, 0.02, n))
        tokens.append((ch, t, t + d))
        t += d
    pieces.append(rng.normal(0, 0.0005, int(0.025 * sr)))
    return np.concatenate(pieces).astype(np.float32), tokens


class PausePlan(unittest.TestCase):
    def test_sentence_and_clause_marks(self):
        toks = [("a", 0.0, 0.3), (".", 0.3, 0.375), (" ", 0.375, 0.425), ("b", 0.425, 0.6), (",", 0.6, 0.65), (" ", 0.65, 0.7), ("c", 0.7, 0.9), (",", 0.9, 0.925), (" ", 0.925, 0.95), ("d", 0.95, 1.2), (".", 1.2, 1.3)]
        plan = dict(takes.pause_plan(toks))
        self.assertAlmostEqual(plan[1], takes.SENTENCE_PAUSE_S - 0.075)  # topped up to 250 ms
        self.assertAlmostEqual(plan[4], takes.CLAUSE_PAUSE_S - 0.05)  # a 50 ms comma: the model stopped there
        self.assertNotIn(7, plan)  # a 25 ms comma: the model ran through it, no cut into sound
        self.assertNotIn(10, plan)  # the last mark: the scene tail follows

    def test_a_batch_join_already_holds_the_pause(self):
        toks = [("a", 0.0, 0.3), (".", 0.3, 0.375), ("b", 0.7, 0.9)]  # 325 ms untimed (a second batch's pad)
        self.assertEqual(takes.pause_plan(toks), [])

    def test_ramp(self):
        r = takes.ramp(120)
        self.assertEqual(len(r), 120)
        self.assertTrue(all(0 < a < b < 1 for a, b in zip(r, r[1:])))


@unittest.skipUnless(HAVE_NUMPY, "numpy not installed")
class Finish(unittest.TestCase):
    TEXT = "ab cd. ef, gh? ij."

    def test_same_tokens_give_the_same_length_whatever_the_noise(self):
        out = []
        for seed in (1, 2, 3):
            audio, toks = kokoro_like(self.TEXT, seed)
            x, t = takes.finish(audio, toks, SR)
            out.append((len(x), [round(a, 6) for _, a, _ in t]))
        self.assertEqual(out[0], out[1])
        self.assertEqual(out[1], out[2])

    def test_timing_lag_and_leading_pad(self):
        audio, toks = kokoro_like(self.TEXT, 5)
        x, t = takes.finish(audio, toks, SR)
        first = next(a for ch, a, _ in t if ch.strip())
        self.assertAlmostEqual(first, takes.LEAD_KEEP_S, places=3)  # 300 ms pad -> 150 ms kept
        # the lag correction moved every timing 47 ms earlier: the pad cut is (0.3 - 0.047) - 0.15
        cut = (0.3 - takes.TIMING_LAG_S) - takes.LEAD_KEEP_S
        self.assertAlmostEqual(len(x) / SR, len(audio) / SR - cut + sum(p for _, p in takes.pause_plan(takes.shift_timings(toks, -takes.TIMING_LAG_S))), places=3)

    def test_no_step_into_or_out_of_silence(self):
        # kokoro-onnx spliced zeros into a -38 dBFS residual: a step of about -38 dBFS at every pause
        audio, toks = kokoro_like(self.TEXT, 7)
        x, _ = takes.finish(audio, toks, SR)
        steps = takes.silence_edge_steps(x, SR)
        self.assertGreaterEqual(len(steps), 4, "the inserted pauses are digital silence")
        loud = [s for s in steps if s[1] > takes.STEP_LIMIT_DBFS]
        self.assertEqual(loud, [], loud)

    def test_the_detector_finds_an_unfaded_splice(self):
        import numpy as np

        rng = random.Random(3)
        x = np.asarray([0.0122 * (1 if rng.random() > 0.5 else -1) for _ in range(2400)] + [0.0] * 2400 + [0.3] * 100, dtype=np.float32)
        steps = takes.silence_edge_steps(x, SR)
        self.assertEqual(len(steps), 2)
        self.assertGreater(max(s[1] for s in steps), -40)


if __name__ == "__main__":
    unittest.main()
