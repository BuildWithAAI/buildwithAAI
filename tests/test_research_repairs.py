"""Regression evidence for supplied research fixtures, never chain settlement."""
from copy import deepcopy
from pathlib import Path
import tempfile
import unittest

from src.multi_brain_research import cohort_binder, reputation_gate, tape_pass
from src.multi_brain_research.curve_decoder import CLASSIFICATION
from src.multi_brain_research.curve_tape import to_tape
from src.multi_brain_research.inventory_gate import CURVE, TOKEN


def fixture():
    return {"mint": TOKEN, "curve_account": CURVE,
            "virtual_reserves": {"base": 1_000_000, "quote": 1_000},
            "real_reserves": {"base": 1, "quote": 1},
            "fee_bps": 100, "slot": 9, "signature": "synthetic-fixture-signature"}


class ResearchRepairTests(unittest.TestCase):
    def test_cohort_imports_as_package_and_preserves_stand_in_classification(self):
        result = cohort_binder.self_check()
        self.assertEqual(result["classification"], "SYNTHETIC_STAND_IN")
        self.assertEqual(result["market_skill"], "NOT_ESTABLISHED")

    def test_decay_and_gate_agree_at_and_around_the_floor(self):
        score = reputation_gate.decay(80, 2)
        self.assertEqual(score, 72)
        for floor, allowed in ((70, True), (72, True), (73, False)):
            self.assertEqual(reputation_gate.gate(score, floor)["hire_allowed"], allowed)
        self.assertEqual(reputation_gate.self_check()["aged"], score)

    def test_converter_preserves_fixture_classification_and_detaches_input(self):
        event = fixture()
        row = to_tape(event)
        self.assertEqual(row["classification"], CLASSIFICATION)
        self.assertEqual(row["action"], "NO_EXECUTION")
        self.assertEqual(len(row["event_sha256"]), 64)
        before = deepcopy(row)
        event["virtual_reserves"]["base"] = 4
        self.assertEqual(row, before)
        self.assertNotEqual(to_tape(event)["event_sha256"], row["event_sha256"])

    def test_foreign_or_malformed_events_are_refused(self):
        cases = [None, [], {**fixture(), "mint": "foreign"},
                 {**fixture(), "curve_account": "foreign"},
                 {**fixture(), "slot": True}, {**fixture(), "fee_bps": -1},
                 {**fixture(), "virtual_reserves": {"base": 0, "quote": 1}}]
        missing = fixture()
        del missing["signature"]
        cases.append(missing)
        for event in cases:
            with self.subTest(event=event):
                self.assertIsNone(to_tape(event))

    def test_caller_cannot_upgrade_fixture_to_chain_evidence(self):
        for classification in ("CHAIN_READ", "REAL_ANONYMIZED", "SIGNED_SNAPSHOT"):
            self.assertIsNone(to_tape({**fixture(), "classification": classification}))
        self.assertIsNone(to_tape({**fixture(), "provenance": {"chain_verified": True}}))

    def test_closed_pass_retains_demo_unit_and_fixture_provenance(self):
        with tempfile.TemporaryDirectory() as folder:
            result = tape_pass.run_with_tape(fixture(), Path(folder) / "demo.jsonl")
        self.assertEqual(result["classification"], CLASSIFICATION)
        self.assertEqual(result["quote_unit"], "MICRO_DEMO_USD")
        self.assertEqual(result["settlement_classification"], "DEMO_CREDITS_ONLY")
        self.assertFalse(result["financial_execution"])
        self.assertEqual(result["event_sha256"], to_tape(fixture())["event_sha256"])

    def test_refused_tape_never_creates_demo_fee_log(self):
        with tempfile.TemporaryDirectory() as folder:
            log = Path(folder) / "refused.jsonl"
            result = tape_pass.run_with_tape({**fixture(), "mint": "foreign"}, log)
            self.assertFalse(result["paid"])
            self.assertFalse(log.exists())


if __name__ == "__main__":
    unittest.main()
