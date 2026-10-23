"""Observable learning boundaries; native Reef interfaces run in their separate locked job."""
from copy import deepcopy
from pathlib import Path
import tempfile
import unittest

from src.ecosystem_research import learning as learn
from src.multi_brain_research import training_lab as lab
from src.solana_research import coin_evidence as ev


class ReportLearningTests(unittest.TestCase):
    def test_induced_workflows_reject_unseen_missing_fields(self):
        for role, seed in learn.fixtures().items():
            cases = learn.curriculum(role, seed)
            candidate = learn.propose(role, cases["train"])
            baseline = learn.evaluate(learn.policy(role, ["protocol"]), cases["holdout"])
            result = learn.evaluate(candidate, cases["holdout"])
            self.assertGreater(baseline["false_accepts"], 1)
            self.assertEqual((result["false_accepts"], result["false_rejects"]), (0, 0))
            self.assertTrue(learn.review(candidate, seed)["accepted"])

    def test_training_and_holdout_have_no_identical_report(self):
        for role, seed in learn.fixtures().items():
            value = learn.curriculum(role, seed)
            training = {lab.digest(c["report"]) for c in value["train"]}
            self.assertFalse(training & {lab.digest(c["report"]) for c in value["holdout"]})

    def test_proposer_refuses_holdout_cases(self):
        role = learn.ROLES[0]
        with self.assertRaisesRegex(ValueError, "PROPOSER_SPLIT"):
            learn.propose(role, learn.curriculum(role, learn.fixtures()[role])["holdout"])

    def test_holdout_edits_cannot_enter_the_proposer_interface(self):
        role = learn.ROLES[1]
        value = learn.curriculum(role, learn.fixtures()[role])
        before = learn.propose(role, value["train"])
        value["holdout"].clear()
        self.assertEqual(before, learn.propose(role, value["train"]))

    def test_missing_training_classes_are_rejected(self):
        role = learn.ROLES[0]
        value = learn.curriculum(role, learn.fixtures()[role])["train"]
        for expected in (True, False):
            copied = deepcopy(value)
            for case in copied:
                case["expected"] = expected
            with self.assertRaisesRegex(ValueError, "CLASS_COVERAGE"):
                learn.propose(role, copied)

    def test_inconsistent_training_labels_cannot_produce_a_policy(self):
        role = learn.ROLES[0]
        seed = learn.fixtures()[role]
        cases = [{"id": "train:" + str(i), "report": deepcopy(seed), "expected": expected}
                 for i, expected in enumerate((True, False))]
        with self.assertRaisesRegex(ValueError, "NO_QUALIFIED_PROPOSAL"):
            learn.propose(role, cases)

    def test_numeric_execution_flags_are_not_booleans(self):
        for role, seed in learn.fixtures().items():
            value = learn.propose(role, learn.curriculum(role, seed)["train"])
            for bad in (0, 1, None, "false", True):
                changed = deepcopy(seed)
                changed["live_execution_allowed"] = bad
                self.assertFalse(learn.review(value, changed)["accepted"])

    def test_cross_role_reports_are_rejected(self):
        reports = learn.fixtures()
        for role, seed in reports.items():
            value = learn.propose(role, learn.curriculum(role, seed)["train"])
            other = next(r for r in learn.ROLES if r != role)
            self.assertFalse(learn.review(value, reports[other])["accepted"])

    def test_forecast_rows_cannot_authorize_execution(self):
        role = learn.ROLES[1]
        seed = learn.fixtures()[role]
        value = learn.propose(role, learn.curriculum(role, seed)["train"])
        for key, bad in (("action", "BUY"), ("prediction_ppm", True), ("prediction_ppm", 1_000_001),
                         ("calibration", "VERIFIED")):
            changed = deepcopy(seed)
            changed["rows"][0][key] = bad
            self.assertFalse(learn.review(value, changed)["accepted"])

    def test_forecast_transaction_units_are_preserved(self):
        role = learn.ROLES[1]
        seed = learn.fixtures()[role]
        value = learn.propose(role, learn.curriculum(role, seed)["train"])
        seed["task"]["horizon_unit"] = "MILLISECONDS"
        self.assertFalse(learn.review(value, seed)["accepted"])

    def test_policy_cannot_add_commands_or_own_evaluator(self):
        for field in ("command", "evaluator", "wallet", "model_weights"):
            value = learn.policy(learn.ROLES[0], ["protocol"])
            value[field] = "arbitrary"
            with self.assertRaises(ValueError):
                learn.validate_policy(value)

    def test_unknown_reordered_or_duplicate_checks_are_rejected(self):
        for checks in (["execute"], ["protocol", "protocol"], ["execution_disabled", "protocol"], []):
            with self.assertRaises(ValueError):
                learn.policy(learn.ROLES[0], checks)

    def test_policy_scope_cannot_be_promoted_to_trading(self):
        for key, bad in (("scope", "LIVE_TRADING"), ("live_execution_allowed", True), ("role", "administrator")):
            value = learn.policy(learn.ROLES[0], ["protocol"])
            value[key] = bad
            with self.assertRaises(ValueError):
                learn.validate_policy(value)

    def test_release_rejection_preserves_the_selected_policy(self):
        role = learn.ROLES[0]
        seed = learn.fixtures()[role]
        baseline = learn.policy(role, ["protocol"])
        proposal = learn.propose(role, learn.curriculum(role, seed)["train"])
        value = learn.release_chain(role, baseline, proposal,
                                    {"proposal": {"selected": True}, "regression": {"selected": False}})
        self.assertEqual(value["active_policy"], proposal)
        self.assertEqual(value["entries"][-1]["active_policy_sha256"], lab.digest(proposal))
        previous = "0" * 64
        for entry in value["entries"]:
            self.assertEqual(entry["previous_sha256"], previous)
            previous = lab.digest({key: item for key, item in entry.items() if key != "sha256"})
            self.assertEqual(previous, entry["sha256"])

    def test_failed_selection_cannot_publish(self):
        baseline = learn.policy(learn.ROLES[0], ["protocol"])
        with self.assertRaisesRegex(ValueError, "SELECTION_REQUIRED"):
            learn.release_chain(learn.ROLES[0], baseline, baseline,
                                {"proposal": {"selected": False}, "regression": {"selected": False}})

    def test_evaluation_requires_both_classes_and_bounded_input(self):
        value = learn.policy(learn.ROLES[0], ["protocol"])
        cases = [{"id": "test", "report": learn.fixtures()[learn.ROLES[0]], "expected": True}] * 2
        with self.assertRaisesRegex(ValueError, "EVALUATION_CLASSES"):
            learn.evaluate(value, cases)
        with self.assertRaisesRegex(ValueError, "EVALUATION_BOUND"):
            learn.evaluate(value, cases * 40)

    def test_public_snapshot_drops_private_fields(self):
        fields = ("policy_sha256", "checks", "training_cases", "holdout_cases",
                  "reference_balanced_accuracy_ppm", "selected_balanced_accuracy_ppm",
                  "regression_rejected", "original_report_accepted", "active_scope")
        row = {key: 1 for key in fields}
        row.update(job_id="private-job", token="private-token", report="private-report")
        result = learn.public_projection({"source_classification": "RPC_CAPTURE", "ecosystem_public_snapshot_sha256": "a" * 64,
                                         "roles": {role: row for role in learn.ROLES}})
        self.assertNotIn("private-", ev.canonical(result))
        self.assertFalse(result["live_execution_allowed"])


class VerifiedInputTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        (self.root / "state").mkdir()
        (self.root / "state/community.sqlite3").write_bytes(b"explicit unit fixture, not a real community database")
        reports = learn.fixtures()
        jobs = {}
        for role, report in reports.items():
            raw = (ev.canonical(report) + "\n").encode()
            (self.root / (role + ".json")).write_bytes(raw)
            jobs[role] = {"state": "SUCCEEDED", "report_sha256": ev.sha(raw), "report_bytes": len(raw)}
        self.write("jobs.json", {"jobs": jobs, "audit": {"audit_head": "a" * 64}})
        self.write("summary.json", {"source_classification": "RPC_CAPTURE", "completed_jobs": 2,
                    "cross_agent_read_denied": True, "live_execution_allowed": False,
                    "payments_performed": False, "audit_head": "a" * 64})
        self.write("gate.json", {"action": "NO_EXECUTION", "research_signal": "ABSTAIN", "live_execution_allowed": False})
        self.write("public-snapshot.json", {"live_execution_allowed": False})

    def write(self, name, value):
        (self.root / name).write_text(ev.canonical(value) + "\n", encoding="utf-8")

    def test_snapshot_binds_exact_file_bytes(self):
        value = learn.source_snapshot(self.root)
        self.assertEqual(set(value["files"]), set(learn.SOURCE_FILES))
        self.assertEqual(value["quality_target"], "INTERNAL_REPORT_CONSISTENCY_ONLY")

    def test_changed_job_digest_is_rejected(self):
        value = ev.read(self.root / "jobs.json")
        value["jobs"][learn.ROLES[0]]["report_sha256"] = "b" * 64
        self.write("jobs.json", value)
        with self.assertRaisesRegex(ValueError, "SOURCE_BINDING"):
            learn.source_snapshot(self.root)

    def test_synthetic_source_cannot_enter_real_job_learning(self):
        value = ev.read(self.root / "summary.json")
        value["source_classification"] = "SYNTHETIC_FIXTURE"
        self.write("summary.json", value)
        with self.assertRaisesRegex(ValueError, "SOURCE_SCOPE"):
            learn.source_snapshot(self.root)

    def test_dataset_conflicts_are_rejected_even_with_updated_job_hash(self):
        role = learn.ROLES[1]
        report = ev.read(self.root / (role + ".json"))
        report["dataset_sha256"] = "b" * 64
        self.write(role + ".json", report)
        raw = (self.root / (role + ".json")).read_bytes()
        jobs = ev.read(self.root / "jobs.json")
        jobs["jobs"][role].update(report_sha256=ev.sha(raw), report_bytes=len(raw))
        self.write("jobs.json", jobs)
        with self.assertRaisesRegex(ValueError, "DATASET_BINDING"):
            learn.source_snapshot(self.root)

    def test_live_execution_flag_is_rejected(self):
        value = ev.read(self.root / "gate.json")
        value["live_execution_allowed"] = True
        self.write("gate.json", value)
        with self.assertRaisesRegex(ValueError, "SOURCE_SCOPE"):
            learn.source_snapshot(self.root)


if __name__ == "__main__":
    unittest.main()
