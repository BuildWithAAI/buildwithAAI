"""Hemibrain first brain: mock episodes, feature_loader, and receipt pins."""
from __future__ import annotations

import unittest
from pathlib import Path

from src.multi_brain_research.feature_loader import features_from_observations
from src.multi_brain_research.first_brain import (
    PLACEHOLDERS,
    admission,
    graph_file,
    score_episode,
)


def _episode():
    return [
        {"last_trade_price": 1.00, "quote_atoms": 100.0, "signed_quote_flow": 0.0},
        {"last_trade_price": 1.20, "quote_atoms": 130.0, "signed_quote_flow": 20.0},
        {"last_trade_price": 0.80, "quote_atoms": 70.0, "signed_quote_flow": -40.0},
        {"last_trade_price": 0.90, "quote_atoms": 80.0, "signed_quote_flow": -5.0},
    ]


class FirstBrainTests(unittest.TestCase):
    def test_feature_loader_changes_with_the_mock_path_and_is_not_a_constant_distance(self):
        rows = _episode()
        first = features_from_observations(rows, 1)
        second = features_from_observations(rows, 2)
        self.assertGreater(first[0], 0)
        self.assertLess(second[0], 0)
        self.assertNotEqual(first[3], second[3])
        self.assertNotEqual(first[3], 0.15)
        self.assertNotEqual(second[3], 0.15)

    def test_short_history_abstains_with_a_real_pin_and_a_longer_mock_can_score(self):
        path = graph_file()
        self.assertIsNotNone(path)
        self.assertTrue(Path(path).is_file())
        short = score_episode(_episode()[:2], 1, path)
        self.assertIsNone(short["paper_long_support_ppm"])
        self.assertEqual(short["abstain_reason"], "MISSING_DATA")
        self.assertNotIn(short["graph_sha256"], PLACEHOLDERS)
        self.assertNotIn(short["model_sha256"], PLACEHOLDERS)
        self.assertEqual(len(short["graph_sha256"]), 64)
        scored = score_episode(_episode(), 3, path, steps=2)
        self.assertEqual(scored["action"], "NO_EXECUTION")
        self.assertFalse(scored["execution_allowed"])
        for field in ("graph_sha256", "model_sha256", "task_sha256"):
            self.assertNotIn(scored[field], PLACEHOLDERS)
            self.assertEqual(len(scored[field]), 64)
        if scored["prediction_ppm"] is not None:
            self.assertEqual(scored["paper_long_support_ppm"], 1_000_000 - scored["prediction_ppm"])
        again = score_episode(_episode(), 3, path, steps=2)
        self.assertEqual(scored["model_sha256"], again["model_sha256"])

    def test_admission_gate_matches_the_unit_checks(self):
        gate = admission()
        self.assertTrue(gate["ready"], gate["reasons"])
        self.assertEqual(gate["role"], "COUNCIL")
        self.assertFalse(gate["execution_allowed"])


if __name__ == "__main__":
    unittest.main()
