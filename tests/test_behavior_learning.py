"""Causal feedback, frozen evaluation, abstention and limited review regressions."""
from copy import deepcopy
from pathlib import Path
import tempfile
import unittest

from src.ecosystem_research import behavior as b, behavior_tasks as tasks
from src.multi_brain_research import trade_fixture, training_lab as lab


def cohort(domain="paper_trading", training=40, holdout=20):
    rows = []
    for split, count, offset in (("train", training, 0), ("holdout", holdout, 1000)):
        for i in range(count):
            target = i % 2
            features = [target] + [0] * (b.WIDTH[domain] - 1)
            rows.append(tasks.task(domain, target, i, split, offset + i, features,
                                   [domain, split, i], ["outcome", domain, split, i, target], target, "test_oracle"))
    return rows


class BehaviorMemoryTests(unittest.TestCase):
    def test_memory_learns_counts_from_training_and_beats_measured_majority(self):
        report = b.domain_report("paper_trading", cohort())
        self.assertTrue(report["evaluation"]["eligible"])
        self.assertEqual(report["evaluation"]["candidate"]["balanced_accuracy_ppm"], 1_000_000)
        self.assertEqual(report["evaluation"]["baseline"]["balanced_accuracy_ppm"], 500_000)
        self.assertEqual(report["model"]["training_examples"], 40)
        self.assertFalse(report["regression_probe"]["eligible"])

    def test_future_outcomes_cannot_be_used_for_fitting(self):
        rows = cohort(holdout=0)
        with self.assertRaisesRegex(ValueError, "FUTURE_FEEDBACK"):
            b.fit("paper_trading", rows, rows[-1]["resolved_at"] - 1)

    def test_holdout_examples_are_rejected_by_fitter(self):
        with self.assertRaisesRegex(ValueError, "FUTURE_FEEDBACK"):
            b.fit("paper_trading", cohort(), 100000)

    def test_label_is_revealed_after_decision_and_prefix_is_invariant(self):
        rows = cohort(training=4, holdout=0)
        for i, row in enumerate(rows):
            row["features"], row["target"] = [1, 0, 0, 0], 1
            row["observed_at"] = [0, 2, 4, 20][i]
            row["resolved_at"] = [10, 12, 14, 30][i]
        before = b.prequential("paper_trading", rows)
        decisions = [r["event"] for r in before["events"] if r["event"]["type"] == "DECISION"]
        self.assertEqual([x["prediction"] for x in decisions], [None, None, None, 1])
        changed = deepcopy(rows)
        changed[0]["target"] = 0
        after = b.prequential("paper_trading", changed)
        def early(trace):
            return [r["event"] for r in trace["events"] if r["event"]["at"] < 10]
        self.assertEqual(early(before), early(after))
        self.assertNotEqual(before["head_sha256"], after["head_sha256"])

    def test_holdout_labels_never_update_prequential_memory(self):
        rows = cohort()
        before = b.prequential("paper_trading", rows)
        changed = deepcopy(rows)
        for row in changed:
            if row["split"] == "holdout":
                row["target"] ^= 1
        after = b.prequential("paper_trading", changed)
        def decisions(trace):
            return [r["event"] for r in trace["events"] if r["event"]["type"] == "DECISION"]
        self.assertEqual(decisions(before), decisions(after))

    def test_unknown_patterns_and_insufficient_support_abstain(self):
        rows = cohort(training=2, holdout=0)
        model = b.fit("paper_trading", rows, 100)
        self.assertEqual(b.predict(model, rows[0]["features"])["action"], "ABSTAIN")
        self.assertEqual(b.predict(model, [-1, 1, 1, 1])["support"], 0)
        self.assertIsNone(b.predict(model, [-1, 1, 1, 1])["probability_ppm"])

    def test_conflicting_outcomes_abstain(self):
        rows = cohort(training=40, holdout=0)
        for row in rows:
            row["features"] = [0, 0, 0, 0]
        model = b.fit("paper_trading", rows, 10000)
        result = b.predict(model, [0, 0, 0, 0])
        self.assertEqual(result["probability_ppm"], 500000)
        self.assertEqual(result["action"], "ABSTAIN")

    def test_group_overlap_is_rejected(self):
        rows = cohort()
        rows[-1]["group"] = rows[0]["group"]
        with self.assertRaisesRegex(ValueError, "GROUP_LEAKAGE"):
            b.validate_cases("paper_trading", rows)

    def test_repeated_source_cannot_cross_partitions(self):
        rows = cohort()
        rows[-1]["source_sha256"] = rows[0]["source_sha256"]
        with self.assertRaisesRegex(ValueError, "DUPLICATE_SOURCE"):
            b.validate_cases("paper_trading", rows)

    def test_training_outcomes_must_precede_all_holdout_observations(self):
        rows = cohort()
        rows[0]["resolved_at"] = rows[-1]["observed_at"]
        with self.assertRaisesRegex(ValueError, "TEMPORAL_LEAKAGE"):
            b.validate_cases("paper_trading", rows)

    def test_boolean_labels_and_features_are_not_integer_measurements(self):
        for field, value in (("target", True), ("features", [True, 0, 0, 0])):
            rows = cohort()
            rows[0][field] = value
            with self.assertRaises(ValueError):
                b.validate_cases("paper_trading", rows)

    def test_wrong_domain_missing_fields_and_nonhex_evidence_are_rejected(self):
        for key, value in (("domain", "unregistered"), ("source_sha256", "z" * 64)):
            rows = cohort()
            rows[0][key] = value
            with self.assertRaises(ValueError):
                b.validate_cases("paper_trading", rows)
        rows = cohort()
        rows[0]["future_signal"] = 1
        with self.assertRaises(ValueError):
            b.validate_cases("paper_trading", rows)

    def test_model_cannot_grant_execution_or_claim_calibration(self):
        model = b.domain_report("paper_trading", cohort())["model"]
        for key, value in (("live_execution_allowed", True), ("confidence", "CALIBRATED"),
                           ("scope", "LIVE"), ("training_examples", True), ("cutoff", -1),
                           ("training_sha256", "x" * 64)):
            changed = {**model, key: value}
            with self.assertRaises(ValueError):
                b.validate_model(changed)

    def test_context_hash_and_count_bindings_are_checked(self):
        model = b.domain_report("paper_trading", cohort())["model"]
        changed = deepcopy(model)
        next(iter(changed["contexts"].values()))["features"][0] = -1
        with self.assertRaisesRegex(ValueError, "CONTEXT_BINDING"):
            b.validate_model(changed)
        changed = deepcopy(model)
        next(iter(changed["contexts"].values()))["one"] = True
        with self.assertRaisesRegex(ValueError, "COUNTS"):
            b.validate_model(changed)

    def test_evaluation_requires_exact_training_evidence_and_cutoff(self):
        rows = cohort()
        model = b.domain_report("paper_trading", rows)["model"]
        changed = deepcopy(rows)
        changed[0]["target"] ^= 1
        with self.assertRaisesRegex(ValueError, "TRAINING_BINDING"):
            b.evaluate(model, changed)
        model["cutoff"] = rows[-1]["observed_at"]
        with self.assertRaisesRegex(ValueError, "EVALUATION_CUTOFF"):
            b.evaluate(model, rows)

    def test_small_and_one_class_cohorts_are_ineligible(self):
        small = b.domain_report("paper_trading", cohort(training=8, holdout=4))["evaluation"]
        self.assertIn("TRAINING_COHORT_TOO_SMALL", small["reasons"])
        self.assertIn("HOLDOUT_COHORT_TOO_SMALL", small["reasons"])
        rows = cohort()
        for row in rows:
            row["target"] = 0
        result = b.domain_report("paper_trading", rows)["evaluation"]
        self.assertIn("HOLDOUT_CLASS_SUPPORT", result["reasons"])
        self.assertIn("NO_MEASURED_BASELINE_IMPROVEMENT", result["reasons"])

    def test_abstention_reduces_balanced_accuracy_and_blocks_qualification(self):
        rows = cohort()
        for row in rows:
            if row["split"] == "holdout":
                row["features"] = [-1, -1, -1, -1]
        result = b.domain_report("paper_trading", rows)["evaluation"]
        self.assertIn("COVERAGE_TOO_LOW", result["reasons"])
        self.assertEqual(result["candidate"]["balanced_accuracy_ppm"], 0)

    def test_critical_error_direction_matches_domain(self):
        for domain in b.DOMAINS:
            actual = 1 if domain == "code_review" else 0
            result = b.measure(domain, [1 - actual], [{"target": actual}])
            self.assertEqual(result["critical_errors"], 1)
            self.assertEqual(b.measure(domain, [None], [{"target": actual}])["critical_errors"], 0)

    def test_no_domain_can_promote_a_critical_regression(self):
        for domain in b.DOMAINS:
            report = b.domain_report(domain, cohort(domain))
            self.assertIn("CRITICAL_ADVISORY_ERRORS", report["regression_probe"]["reasons"])
            self.assertFalse(report["actual_execution_authorized"])


class StaticReviewTests(unittest.TestCase):
    def test_aliases_are_resolved_for_limited_review_cues(self):
        samples = (("import builtins as b\nb.exec(text)", 0),
                   ("from subprocess import run as r\nr(cmd, shell=True)", 1),
                   ("from os import system as s\ns(cmd)", 1),
                   ("import os as o\no.popen(cmd)", 1),
                   ("import pickle as p\np.loads(data)", 2),
                   ("import yaml as y\ny.unsafe_load(data)", 2),
                   ("from httpx import get as g\ng(url, verify=False)", 3))
        for text, cue in samples:
            with self.subTest(text=text):
                signals, findings = tasks.code_signals(text)
                self.assertEqual(signals[cue], 1)
                self.assertEqual(sum(signals), 1)
                self.assertEqual(len(findings), 1)

    def test_syntax_error_requires_review(self):
        self.assertEqual(tasks.code_signals("def broken(:")[0], [0, 0, 0, 0, 1])

    def test_code_is_parsed_without_execution(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "should-not-exist"
            tasks.code_signals(f"open({str(path)!r}, 'w').write('executed')")
            self.assertFalse(path.exists())

    def test_comments_strings_and_safe_call_arguments_do_not_match_calls(self):
        signals, findings = tasks.code_signals("# eval(text)\ns = 'pickle.loads(data)'\nimport subprocess\nsubprocess.run(['echo', 'ok'], shell=False)")
        self.assertEqual(signals, [0, 0, 0, 0, 0])
        self.assertEqual(findings, [])

    def test_oversized_code_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "CODE_BOUND"):
            tasks.code_signals("x" * (256 * 1024 + 1))


class RecordedBehaviorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        _, cls.data, cls.plan = trade_fixture.demo()
        cls.forecast = {"dataset_sha256": lab.digest(cls.data), "live_execution_allowed": False,
                        "task": {"horizon_unit": "LATER_MARKET_TRANSACTIONS", "count": 1, "max_horizon_slots": 2},
                        "model_sha256": "a" * 64,
                        "rows": [{"episode_id": e["episode_id"], "sequence": i, "order": row["order"],
                                  "prediction_ppm": 500000, "action": "NO_EXECUTION"}
                                 for e in cls.data["episodes"] for i, row in enumerate(e["observations"])]}

    def test_delayed_direction_labels_preserve_missing_outcomes(self):
        value = b.recorded_trade_feedback(self.data, self.forecast, self.plan)
        self.assertEqual((value["observations"], value["resolved_outcomes"], value["pending_outcomes"]), (384, 372, 12))
        for row in value["rows"]:
            if row["target"] is None:
                self.assertEqual(row["outcome_status"], "PENDING_UNLABELED")
                self.assertIsNone(row["outcome_order"])
            else:
                self.assertGreater(tuple(row["outcome_order"]), tuple(row["observed_order"]))
        self.assertFalse(value["weight_training_performed"])
        self.assertFalse(value["profit_or_executable_return_measured"])
        self.assertFalse(value["live_observer_latency_known"])

    def test_missing_or_duplicate_forecasts_are_rejected(self):
        for mode in ("missing", "duplicate"):
            forecast = deepcopy(self.forecast)
            if mode == "missing":
                forecast["rows"].pop()
            else:
                forecast["rows"].append(forecast["rows"][0])
            with self.assertRaisesRegex(ValueError, "FORECAST_COVERAGE|DUPLICATE_FORECAST"):
                b.recorded_trade_feedback(self.data, forecast, self.plan)

    def test_wrong_source_task_or_order_is_rejected(self):
        for field, value in (("dataset_sha256", "b" * 64), ("live_execution_allowed", True)):
            forecast = {**self.forecast, field: value}
            with self.assertRaises(ValueError):
                b.recorded_trade_feedback(self.data, forecast, self.plan)
        forecast = deepcopy(self.forecast)
        forecast["task"]["horizon_unit"] = "MILLISECONDS"
        with self.assertRaises(ValueError):
            b.recorded_trade_feedback(self.data, forecast, self.plan)
        forecast = deepcopy(self.forecast)
        forecast["rows"][0]["order"] = [1, 1]
        with self.assertRaisesRegex(ValueError, "FORECAST_ROW"):
            b.recorded_trade_feedback(self.data, forecast, self.plan)

    def test_invalid_probability_and_zero_horizon_are_rejected(self):
        forecast = deepcopy(self.forecast)
        forecast["rows"][0]["prediction_ppm"] = True
        with self.assertRaisesRegex(ValueError, "FORECAST_ROW"):
            b.recorded_trade_feedback(self.data, forecast, self.plan)
        with self.assertRaises(ValueError):
            b.recorded_trade_feedback(self.data, self.forecast, {**self.plan, "horizon_transactions": 0})


if __name__ == "__main__":
    unittest.main()
