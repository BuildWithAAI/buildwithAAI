"""Causal FlyVis market readout. Frozen flash kernels, not a new network pass."""
from __future__ import annotations

import unittest

from src.multi_brain_research.flyvis_market import (
    ACTIVITY_SOURCE,
    _split,
    fit_readout,
    fit_weights,
    frozen_kernels,
    predict_ppm,
    stimulus_from_history,
)


def _row(price, ts, buys=2, sells=1, liquidity=100.0):
    return {
        "ts": ts,
        "price_usd": price,
        "buys_h1": buys,
        "sells_h1": sells,
        "liquidity_usd": liquidity,
    }


class FlyvisMarketTests(unittest.TestCase):
    def test_stimulus_uses_only_the_supplied_history(self):
        history = [_row(1.0, "t0"), _row(1.2, "t1", buys=4, sells=1, liquidity=110)]
        trace = stimulus_from_history(history)
        self.assertEqual(len(trace), 1)
        self.assertGreater(trace[0], 0)
        fallen = stimulus_from_history([_row(1.0, "t0"), _row(0.8, "t1", buys=1, sells=4, liquidity=80)])
        self.assertLess(fallen[0], 0)
        with self.assertRaises(ValueError):
            stimulus_from_history([_row(1.0, "t0")])

    def test_train_split_ignores_later_labels(self):
        rows = []
        for index, stamp in enumerate(("t1", "t2", "t3", "t4")):
            rows.append({"ts": stamp, "mint": "m", "label": 1 if index < 2 else 0, "activity": [1.0, -1.0]})
        train, test = _split(rows)
        self.assertLess(max(row["ts"] for row in train), min(row["ts"] for row in test))
        weights, bias = fit_weights(train, steps=5)
        for row in test:
            row["label"] = 1 - row["label"]
        again, bias_again = fit_weights(train, steps=5)
        self.assertEqual(weights, again)
        self.assertEqual(bias, bias_again)
        self.assertIsInstance(predict_ppm([1.0, -1.0], weights, bias), int)

    def test_frozen_kernels_match_the_published_flash_array(self):
        labels, kernels = frozen_kernels()
        self.assertEqual(len(labels), 57)
        self.assertNotIn("R1", labels)
        self.assertEqual(len(kernels), 57)
        self.assertGreater(len(kernels[0]), 100)
        self.assertTrue(all(isinstance(value, float) for value in kernels[0][:5]))

    def test_readout_on_a_two_time_pattern_reports_a_held_out_slice(self):
        series = {}
        for mint_index in range(6):
            mint = f"mint-{mint_index}"
            up = mint_index % 2 == 0
            prices = [1.0, 1.1, 1.2, 1.3] if up else [1.0, 0.9, 0.8, 0.7]
            series[mint] = [
                _row(price, f"2026-11-04T05:{15 + step * 5:02d}:00+00:00", buys=4 if up else 1, sells=1 if up else 4)
                for step, price in enumerate(prices)
            ]
        report = fit_readout(series)
        self.assertEqual(report["activity_source"], ACTIVITY_SOURCE)
        self.assertFalse(report["network_forward_pass"])
        self.assertFalse(report["market_validation_established"])
        self.assertFalse(report["execution_allowed"])
        self.assertGreater(report["train"]["n"], 0)
        self.assertGreater(report["test"]["n"], 0)
        self.assertLess(report["train_end_ts"], report["test_start_ts"])
        self.assertGreaterEqual(report["test"]["accuracy"], 0)
        self.assertLessEqual(report["test"]["accuracy"], 1)


if __name__ == "__main__":
    unittest.main()
