"""Actual HTTP paper episode and independent-accounting adversarial regressions."""

from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
import uuid

import paper_evaluation as pe

sys.path.insert(0, str(pe.COMMUNITY / "tests"))
sys.path.insert(0, str(pe.COMMUNITY / "scripts"))
from helpers import Fixture  # noqa: E402
from model_fixture import ModelFixture  # noqa: E402
from zoora_community.client import Client  # noqa: E402
from zoora_community.practice_worker import run_practice  # noqa: E402
from zoora_community.store import now_ms  # noqa: E402
from zoora_community.validation import Problem, canonical  # noqa: E402
from zoora_community.wsgi_server import WSGIServer  # noqa: E402


class CohortTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.f = Fixture(real_time=True)
        cls.addClassCleanup(cls.f.close)
        _, cls.operator = cls.f.operator()
        enrolled = cls.f.store.call("POST", "/v1/agents",
                                    cls.f.enrollment(cls.operator, "cohort_agent"), cls.operator)[1]
        cls.agent_id = enrolled["agent"]["id"]
        cls.agent_token = enrolled["credential"]["token"]
        cls.credential = cls.f.root / "agent.json"
        pe.write_document(cls.credential, enrolled["credential"])
        cls.episode = cls.f.store.call("POST", "/v1/practice/episodes",
                                      {"request_id": uuid.uuid4().hex}, cls.f.owner)[1]["id"]
        cls.base = "/v1/practice/episodes/" + cls.episode
        cls.f.store.call("POST", cls.base + "/accounts",
                        {"request_id": uuid.uuid4().hex, "agent_id": cls.agent_id,
                         "model_pipeline_sha256": "a" * 64}, cls.operator)
        cls.scope = {"version": 1, "experiment_id": uuid.uuid4().hex, "episode_id": cls.episode,
                     "agent_id": cls.agent_id,
                     "instance_id": cls.f.store.call("GET", "/v1/status")[1]["instance_id"],
                     "model": "synthetic-fixture", "model_pipeline_sha256": "a" * 64,
                     "created_at_ms": now_ms() - 1000, "expires_at_ms": now_ms() + 3_600_000,
                     "max_decisions": 3, "max_buy_micro": 10_000_000}
        cls.plan = {"protocol": pe.PLAN, "plan_id": uuid.uuid4().hex, "created_at_ms": now_ms() - 500,
                    "unit": "MICRO_DEMO_USD",
                    "entries": [{**{k: cls.scope[k] for k in pe.IDENTITY},
                                 "label": "Synthetic protocol fixture; no model skill claim"}]}
        cls.scope_path = cls.f.root / "scope.json"
        pe.write_document(cls.scope_path, cls.scope)
        cls.journal = cls.f.root / "journal"
        cls.server = WSGIServer(cls.f.store, 0)
        cls.thread = threading.Thread(target=cls.server.serve_forever)
        cls.thread.start()
        cls.addClassCleanup(cls.stop_server)
        coin = cls.f.store.call("GET", cls.base, token=cls.agent_token)[1]["market"]["coins"][0]
        model = ModelFixture(actions=[{"action": "paper_decision",
                                      "arguments": {"side": "BUY", "coin_id": coin["id"],
                                                    "amount": 1_000_000, "min_output": 1,
                                                    "note": "Synthetic protocol fixture only."}}]).start()
        cls.addClassCleanup(model.stop)
        result = run_practice(cls.credential, cls.scope_path, cls.journal, model="synthetic-fixture",
                              port=cls.server.server_port, model_port=model.port)
        if result["state"] != "ORDER_ACCEPTED_PENDING":
            raise RuntimeError("paper order did not enter pending state")
        cls.interim = cls.f.root / "interim.json"
        pe.capture(cls.journal, cls.credential, cls.interim, port=cls.server.server_port)
        cls.interim_journal = cls.f.root / "interim-journal"
        shutil.copytree(cls.journal, cls.interim_journal)
        # Advance only the synthetic server's test clock, keeping writes below its real rate limit.
        cls.f.at = now_ms() + 60_000

        def clock():
            cls.f.at += 2000
            return cls.f.at

        cls.f.store.clock = clock
        cls.f.store.call("POST", cls.base + "/step",
                        {"request_id": uuid.uuid4().hex, "expected_tick": 0}, cls.f.owner)
        held = cls.f.store.call("GET", cls.base + "/accounts/" + cls.agent_id,
                                token=cls.agent_token)[1]["positions"][0]["tokens"]
        model.actions = [{"action": "paper_decision",
                          "arguments": {"side": "SELL", "coin_id": coin["id"],
                                        "amount": held // 2, "min_output": 1,
                                        "note": "Synthetic partial exit for accounting verification."}}]
        run_practice(cls.credential, cls.scope_path, cls.journal, model="synthetic-fixture",
                     port=cls.server.server_port, model_port=model.port)
        cls.f.store.call("POST", cls.base + "/step",
                        {"request_id": uuid.uuid4().hex, "expected_tick": 1}, cls.f.owner)
        model.actions = [{"action": "paper_decision",
                          "arguments": {"side": "BUY", "coin_id": coin["id"], "amount": 1_000_000,
                                        "min_output": 9_000_000_000_000_000,
                                        "note": "Intentionally impossible minimum to verify rejected-order gas."}}]
        run_practice(cls.credential, cls.scope_path, cls.journal, model="synthetic-fixture",
                     port=cls.server.server_port, model_port=model.port)
        cls.f.store.call("POST", cls.base + "/step",
                        {"request_id": uuid.uuid4().hex, "expected_tick": 2}, cls.f.owner)
        run_practice(cls.credential, cls.scope_path, cls.journal, model="synthetic-fixture",
                     port=cls.server.server_port, model_port=model.port)
        for tick in range(3, 120):
            cls.f.store.call("POST", cls.base + "/step",
                            {"request_id": uuid.uuid4().hex, "expected_tick": tick}, cls.f.owner)
        cls.capture_path = cls.f.root / "closed.json"
        cls.capture_summary = pe.capture(cls.journal, cls.credential, cls.capture_path,
                                         port=cls.server.server_port)
        cls.capture_value, _ = pe.read_document(cls.capture_path)
        if [r["state"] for r in cls.capture_value["receipts"]] != ["FILLED", "FILLED", "REJECTED"]:
            raise RuntimeError("buy, partial sell, rejected minimum fixture differed from its accounting contract")
        if cls.f.store.audit()["database_integrity"] != "OK":
            raise RuntimeError("synthetic source database failed its independent server audit")

    @classmethod
    def stop_server(cls):
        cls.server.shutdown()
        cls.thread.join(10)
        if cls.thread.is_alive():
            raise RuntimeError("HTTP fixture did not stop")

    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        shutil.copytree(self.journal, self.root / "journal")
        self.plan_value = deepcopy(self.plan)
        self.capture_data = deepcopy(self.capture_value)
        self.plan_path = self.root / "plan.json"
        self.bundle_path = self.root / "bundle.json"
        self.data_path = self.root / "capture.json"
        self.report_path = self.root / "report.json"
        self.bundle = {"protocol": pe.BUNDLE, "plan_sha256": pe.digest(self.plan_value),
                       "entries": [{"experiment_id": self.scope["experiment_id"],
                                    "journal_dir": "journal", "capture_file": "capture.json",
                                    "capture_sha256": ""}]}

    @staticmethod
    def replace(path, value):
        path.unlink(missing_ok=True)
        return pe.write_document(path, value)

    def save(self):
        self.replace(self.plan_path, self.plan_value)
        sha = self.replace(self.data_path, self.capture_data)
        self.bundle["plan_sha256"] = pe.digest(self.plan_value)
        self.bundle["entries"][0]["capture_sha256"] = sha
        self.replace(self.bundle_path, self.bundle)

    def evaluate(self):
        self.save()
        result = pe.evaluate(self.plan_path, self.bundle_path, self.report_path)
        report, sha = pe.read_document(self.report_path)
        self.assertEqual(result["report_sha256"], sha)
        return result, report

    def assert_invalid(self, reason):
        result, report = self.evaluate()
        self.assertEqual(result["status"], "COHORT_INCOMPLETE")
        self.assertIsNone(report["summary"])
        self.assertEqual(report["rows"][0]["status"], "INVALID")
        self.assertEqual(report["rows"][0]["reason"], reason)

    def test_closed_actual_episode_reconciles_cash_fees_gas_and_cash_baseline(self):
        result, report = self.evaluate()
        self.assertEqual(result["status"], "COHORT_COMPLETE")
        totals = report["rows"][0]["accounting"]
        self.assertEqual(totals["cash_baseline_micro"], 10_000_000_000)
        sale = self.capture_data["receipts"][1]
        self.assertEqual(totals["cash_micro"], 10_000_000_000 - 1_000_000 - 3000 + sale["output"])
        self.assertEqual(totals["fees_micro"], 10_000 + sale["fee_micro"])
        self.assertEqual(totals["gas_micro"], 3000)
        self.assertEqual(totals["filled_orders"], 2)
        self.assertEqual(totals["rejected_orders"], 1)
        self.assertEqual(totals["total_exit_estimate_micro"],
                         self.capture_data["account"]["liquidation_equity_micro"])
        self.assertEqual(report["performance_edge"], "NOT_ESTABLISHED")
        self.assertFalse(report["live_execution_allowed"])

    def test_capture_uses_only_get_and_contains_no_bearer(self):
        methods = []
        original = Client.request

        def record(client, method, route, body=None, token=None):
            methods.append(method)
            self.assertIsNone(body)
            return original(client, method, route, body, token)

        with patch.object(Client, "request", record):
            result = pe.capture(self.journal, self.credential, self.root / "fresh.json",
                                port=self.server.server_port)
        self.assertTrue(methods)
        self.assertEqual(set(methods), {"GET"})
        raw = (self.root / "fresh.json").read_text(encoding="utf-8")
        for token in (self.agent_token, self.operator, self.f.owner):
            self.assertNotIn(token, raw)
        self.assertEqual(result["tick"], 120)

    def test_offline_evaluation_cannot_request_network_or_model(self):
        self.save()
        with patch.object(Client, "request", side_effect=AssertionError("network used offline")):
            result = pe.evaluate(self.plan_path, self.bundle_path, self.report_path)
        self.assertEqual(result["status"], "COHORT_COMPLETE")

    def test_missing_planned_trial_is_retained_and_blocks_aggregate(self):
        extra = deepcopy(self.plan_value["entries"][0])
        extra.update(experiment_id=uuid.uuid4().hex, agent_id=uuid.uuid4().hex, label="Missing trial")
        self.plan_value["entries"].append(extra)
        result, report = self.evaluate()
        self.assertEqual(result["completed_trials"], 1)
        self.assertEqual(result["planned_trials"], 2)
        self.assertEqual(report["rows"][1]["status"], "MISSING")
        self.assertIsNone(report["summary"])

    def test_duplicate_plan_account_is_rejected(self):
        extra = deepcopy(self.plan_value["entries"][0])
        extra["experiment_id"] = uuid.uuid4().hex
        self.plan_value["entries"].append(extra)
        with self.assertRaises(Problem):
            self.evaluate()

    def test_unplanned_trial_is_rejected(self):
        self.bundle["entries"].append({**self.bundle["entries"][0], "experiment_id": uuid.uuid4().hex})
        with self.assertRaises(Problem):
            self.evaluate()

    def test_capture_byte_pin_detects_even_whitespace_change(self):
        self.save()
        with self.data_path.open("ab") as output:
            output.write(b"\n")
        result = pe.evaluate(self.plan_path, self.bundle_path, self.report_path)
        report, _ = pe.read_document(self.report_path)
        self.assertEqual(result["completed_trials"], 0)
        self.assertEqual(report["rows"][0]["reason"], "EVALUATION_CAPTURE_PIN_MISMATCH")

    def test_late_plan_cannot_be_scored_as_declared_before_trial(self):
        self.plan_value["created_at_ms"] = now_ms() + 60_000
        self.assert_invalid("EVALUATION_PLAN_DECLARED_TOO_LATE")

    def test_pipeline_identity_change_is_rejected(self):
        self.plan_value["entries"][0]["model_pipeline_sha256"] = "b" * 64
        self.assert_invalid("EVALUATION_IDENTITY_MISMATCH")

    def test_capture_must_pin_exact_journal_evidence(self):
        self.capture_data["journal_evidence_sha256"] = "0" * 64
        self.assert_invalid("EVALUATION_JOURNAL_PIN_MISMATCH")

    def test_open_episode_and_pending_order_remain_interim(self):
        shutil.rmtree(self.root / "journal")
        shutil.copytree(self.interim_journal, self.root / "journal")
        self.capture_data = pe.read_document(self.interim)[0]
        result, report = self.evaluate()
        self.assertEqual(result["status"], "COHORT_INCOMPLETE")
        self.assertEqual(report["rows"][0]["status"], "INTERIM")
        self.assertIsNone(report["rows"][0]["accounting"])

    def test_untracked_manual_order_is_rejected(self):
        self.capture_data["receipts"][0]["request_id"] = uuid.uuid4().hex
        self.assert_invalid("EVALUATION_UNTRACKED_OR_DUPLICATE_ORDER")

    def test_duplicate_receipt_is_rejected(self):
        self.capture_data["receipts"].append(deepcopy(self.capture_data["receipts"][0]))
        self.assert_invalid("EVALUATION_UNTRACKED_OR_DUPLICATE_ORDER")

    def test_settlement_receipt_cannot_change_after_journal_sealed(self):
        self.capture_data["receipts"][0]["amount"] += 1
        self.assert_invalid("EVALUATION_ORDER_BODY_CHANGED")

    def test_cash_cannot_disagree_even_when_capture_is_repinned(self):
        self.capture_data["account"]["cash_micro"] += 1
        self.assert_invalid("EVALUATION_ACCOUNT_TOTALS_MISMATCH")

    def test_fees_and_gas_cannot_disappear_from_account(self):
        for field in ("fees_micro", "gas_micro"):
            with self.subTest(field=field):
                self.capture_data = deepcopy(self.capture_value)
                self.capture_data["account"][field] = 0
                self.report_path.unlink(missing_ok=True)
                self.assert_invalid("EVALUATION_ACCOUNT_TOTALS_MISMATCH")

    def test_exit_estimate_is_recomputed_from_public_reserves(self):
        self.capture_data["account"]["positions"][0]["net_exit_micro"] += 1
        self.assert_invalid("EVALUATION_EXIT_ESTIMATE_MISMATCH")

    def test_private_future_or_missing_history_cannot_extend_observed_clock(self):
        self.capture_data["history"].pop(0)
        self.assert_invalid("EVALUATION_HISTORY_GAP")

    def test_bool_cannot_replace_an_integer_amount(self):
        self.capture_data["account"]["cash_micro"] = True
        self.assert_invalid("INVALID_PRACTICE_WORKER_INTEGER")

    def test_failed_inference_is_preserved_as_failed_trial(self):
        journal = pe.Journal(self.root / "journal")
        observation = journal.read(journal.name(0, "observation"))
        journal.save(journal.name(0, "failure"),
                     {"snapshot_sha256": observation["snapshot_sha256"], "error": "INFERENCE_INTERRUPTED_ABSTAIN"})
        with journal.locked():
            review = pe.review_locked(journal, journal.read("manifest.json"))
        self.capture_data["journal_evidence_sha256"] = review["evidence_sha256"]
        result, report = self.evaluate()
        self.assertEqual(result["status"], "COHORT_INCOMPLETE")
        self.assertEqual(report["rows"][0]["status"], "FAILED_TRIAL")
        self.assertIsNone(report["summary"])

    def test_fee_formula_is_independent_of_mutually_changed_receipt_and_account(self):
        self.capture_data["receipts"][0]["fee_micro"] += 1
        self.capture_data["account"]["fees_micro"] += 1
        journal = pe.Journal(self.root / "journal")
        name = journal.name(0, "settlement")
        settlement = journal.read(name)
        settlement["receipt"]["fee_micro"] += 1
        self.replace(journal.folder / name, settlement)
        with journal.locked():
            review = pe.review_locked(journal, journal.read("manifest.json"))
        self.capture_data["journal_evidence_sha256"] = review["evidence_sha256"]
        self.assert_invalid("EVALUATION_FEE_MISMATCH")

    def test_genesis_commitment_must_match_observed_trial(self):
        self.capture_data["commitment"] = "f" * 64
        self.assert_invalid("EVALUATION_OBSERVATION_CHANGED")

    def test_existing_report_is_never_overwritten(self):
        self.evaluate()
        original = self.report_path.read_bytes()
        with self.assertRaises(FileExistsError):
            pe.evaluate(self.plan_path, self.bundle_path, self.report_path)
        self.assertEqual(self.report_path.read_bytes(), original)

    def test_capture_role_and_origin_fail_without_order_or_clock_mutation(self):
        owner_out = self.root / "wrong-role.json"
        before = self.f.store.call("GET", self.base, token=self.agent_token)[1]
        with self.assertRaises(Problem):
            pe.capture(self.journal, self.f.owner_path, owner_out, port=self.server.server_port)
        self.assertFalse(owner_out.exists())
        with self.assertRaises(Problem):
            pe.capture(self.journal, self.credential, owner_out,
                       community_origin="https://example.invalid")
        after = self.f.store.call("GET", self.base, token=self.agent_token)[1]
        self.assertEqual(before, after)

    def test_actual_cli_capture_and_offline_report_exit_status_and_hash(self):
        self.save()
        result = subprocess.run([sys.executable, "-bb", "-X", "dev", "-W", "error",
                                 str(Path(pe.__file__)), "capture", "--journal-dir", str(self.journal),
                                 "--credential-file", str(self.credential), "--port",
                                 str(self.server.server_port), "--out", str(self.root / "cli-capture.json")],
                                capture_output=True, text=True, timeout=90, check=False)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        captured = json.loads(result.stdout)
        self.assertEqual(captured["capture_sha256"],
                         hashlib.sha256((self.root / "cli-capture.json").read_bytes()).hexdigest())
        result = subprocess.run([sys.executable, "-bb", "-X", "dev", "-W", "error",
                                 str(Path(pe.__file__)), "evaluate", "--plan", str(self.plan_path),
                                 "--bundle", str(self.bundle_path), "--out", str(self.report_path)],
                                capture_output=True, text=True, timeout=90, check=False)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(json.loads(result.stdout)["status"], "COHORT_COMPLETE")
        extra = deepcopy(self.plan_value["entries"][0])
        extra.update(experiment_id=uuid.uuid4().hex, agent_id=uuid.uuid4().hex, label="Missing CLI trial")
        self.plan_value["entries"].append(extra)
        self.save()
        result = subprocess.run([sys.executable, str(Path(pe.__file__)), "evaluate",
                                 "--plan", str(self.plan_path), "--bundle", str(self.bundle_path),
                                 "--out", str(self.root / "incomplete.json")],
                                capture_output=True, text=True, timeout=90, check=False)
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertEqual(json.loads(result.stdout)["status"], "COHORT_INCOMPLETE")
        self.assertIsNone(pe.read_document(self.root / "incomplete.json")[0]["summary"])

    def test_evidence_artifact_retains_replayable_inputs_and_exact_source_pins(self):
        self.save()
        result = pe.evaluate(self.plan_path, self.bundle_path, self.report_path)
        self.assertEqual(result["status"], "COHORT_COMPLETE")
        destination = os.environ.get("EVIDENCE_OUTPUT")
        if destination is None:
            return
        target = Path(destination)
        target.mkdir(mode=0o700, parents=True)
        shutil.copytree(self.root / "journal", target / "journal")
        for name in ("plan.json", "bundle.json", "capture.json", "report.json"):
            shutil.copy2(self.root / name, target / name)
        sources = ("research/practice-evaluation/paper_evaluation.py",
                   "research/practice-evaluation/test_paper_evaluation.py",
                   "research/practice-evaluation/README.md",
                   "research/practice-evaluation/pyproject.toml",
                   ".github/workflows/practice-evaluation.yml")
        pins = {name: hashlib.sha256((pe.ROOT / name).read_bytes()).hexdigest() for name in sources}
        evidence = {"classification": "ACTUAL_HTTP_SYNTHETIC_MODEL_PROTOCOL_FIXTURE",
                    "source_head_sha": os.environ.get("SOURCE_HEAD_SHA", "UNAVAILABLE"),
                    "source_sha256": pins, "report": result, "closed_tick": 120,
                    "model_training": "NOT_PERFORMED", "performance_edge": "NOT_ESTABLISHED",
                    "live_execution_allowed": False}
        pe.write_document(target / "verification.json", evidence)
        for path in target.rglob("*.json"):
            raw = path.read_bytes()
            for token in (self.agent_token, self.operator, self.f.owner):
                self.assertNotIn(token.encode("ascii"), raw)
        print("PAPER_COHORT_VERIFICATION " + canonical(evidence))


if __name__ == "__main__":
    unittest.main()
