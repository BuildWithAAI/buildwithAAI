import unittest

from helpers import dataset, delayed, gap, prefix, value

from zoora_sfp.data import HOUR, D, decimal_text, precision
from zoora_sfp.detector import detect, event_labels, trend_context


class DetectorTests(unittest.TestCase):
    def test_bullish_bearish_geometry(self):
        signals, _ = detect(dataset())
        self.assertEqual([s.index for s in signals if s.direction == "BULLISH"],
                         [240, 280, 320, 360])
        self.assertTrue(any(s.direction == "BEARISH" for s in signals))

    def test_every_reference_was_confirmed_before_candidate_open(self):
        ds = dataset()
        for s in detect(ds)[0]:
            self.assertLessEqual(s.pivot_confirmed_ms, ds.bars[s.index].open_ms)
            self.assertGreaterEqual(s.available_ms, ds.bars[s.index].close_ms)
            self.assertGreaterEqual(s.index - s.pivot_index, 3)

    def test_future_tail_cannot_change_earlier_signals_or_ids(self):
        original = [s.record() for s in detect(dataset())[0] if s.index < 280]
        truncated = [s.record() for s in detect(dataset(prefix(280)))[0]]
        self.assertEqual(original, truncated)
        v = value()
        for b in v["bars"][300:]:
            b.update(open="500", high="600", low="400", close="500")
        changed = [s.record() for s in detect(dataset(v))[0] if s.index < 280]
        self.assertEqual(original, changed)

    def test_reclaim_equality_is_not_a_signal(self):
        ds = dataset()
        s = next(s for s in detect(ds)[0] if s.index == 240)
        v = value()
        v["bars"][240]["close"] = decimal_text(s.level)
        self.assertNotIn(240, [s.index for s in detect(dataset(v))[0]])

    def test_sweep_threshold_is_strict(self):
        with precision():
            s = next(s for s in detect(dataset())[0] if s.index == 240)
            v = value()
            v["bars"][240]["low"] = decimal_text(s.level - D("0.05") * s.atr)
            self.assertNotIn(240, [s.index for s in detect(dataset(v))[0]])

    def test_two_sided_rejection_abstains(self):
        v = value()
        v["bars"][240]["high"] = "110"
        signals, skips = detect(dataset(v))
        self.assertNotIn(240, [s.index for s in signals])
        self.assertGreater(skips["AMBIGUOUS_TWO_SIDED"], 0)

    def test_plateau_is_not_a_strict_pivot(self):
        v = value()
        v["bars"][234]["low"] = v["bars"][233]["low"]
        signals, _ = detect(dataset(v))
        self.assertFalse(any(s.pivot_index == 234 for s in signals))

    def test_missing_and_stale_history_abstain(self):
        signals, skips = detect(dataset(delayed(value(), 2 * HOUR)))
        self.assertEqual(signals, [])
        self.assertTrue(skips)
        signals, _ = detect(dataset(gap(value(), 238)))
        self.assertNotIn(239, [s.index for s in signals])

    def test_consumption_does_not_repeat_reference(self):
        signals, _ = detect(dataset())
        pairs = [(s.direction, s.pivot_index) for s in signals]
        self.assertEqual(len(pairs), len(set(pairs)))

    def test_unclosed_higher_context_is_not_available(self):
        ds = dataset()
        self.assertIsNone(trend_context(ds.bars, ds.bars[199].available_ms))
        cutoff = ds.bars[239].available_ms
        before = trend_context(ds.bars, cutoff)
        v = value()
        for b in v["bars"][240:]:
            b.update(open="500", high="600", low="400", close="500")
        self.assertEqual(before, trend_context(dataset(v).bars, cutoff))

    def test_future_labels_are_separate_and_missing_horizons_explicit(self):
        ds = dataset()
        signals = detect(ds)[0]
        labels = event_labels(ds, signals)
        self.assertEqual(len(labels), len(signals) * 4)
        self.assertTrue(all(x["classification"] == "LABEL" for x in labels))
        last = next(s for s in signals if s.index == 360)
        result = next(x for x in labels if x["signal_id"] == last.id and x["horizon_bars"] == 168)
        self.assertIsNone(result["return"])
        self.assertEqual(result["missing_reason"], "INSUFFICIENT_FUTURE_OBSERVATIONS")

    def test_gap_inside_label_window_not_compressed_into_return(self):
        ds = dataset(gap(value(), 248))
        signals = detect(ds)[0]
        s = next(s for s in signals if s.index == 240)
        result = next(x for x in event_labels(ds, signals)
                      if x["signal_id"] == s.id and x["horizon_bars"] == 24)
        self.assertEqual(result["missing_reason"], "GAP_IN_OUTCOME_WINDOW")
        self.assertIsNone(result["return"])


if __name__ == "__main__":
    unittest.main()
