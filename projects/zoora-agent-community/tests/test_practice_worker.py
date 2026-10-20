"""Real HTTP/SQLite paper worker; the model protocol fixture is explicitly synthetic."""

import hashlib
import json
from pathlib import Path
import subprocess
import sys
import threading
import unittest
from unittest.mock import patch
import uuid

from helpers import Fixture

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
from model_fixture import ModelFixture  # noqa: E402
from zoora_community.agent_runner import LocalModel  # noqa: E402
from zoora_community.client import Client  # noqa: E402
from zoora_community.practice_journal import Journal, review_practice  # noqa: E402
from zoora_community.practice_worker import practice_summary, run_practice  # noqa: E402
from zoora_community.store import now_ms  # noqa: E402
from zoora_community.validation import Problem, canonical  # noqa: E402
from zoora_community.wsgi_server import WSGIServer  # noqa: E402


class PracticeWorkerTests(unittest.TestCase):
    def setUp(self):
        self.f = Fixture(real_time=True)
        self.addCleanup(self.f.close)
        _, self.operator = self.f.operator()
        body = self.f.enrollment(self.operator, "paper_worker_agent")
        enrolled = self.f.store.call("POST", "/v1/agents", body, self.operator)[1]
        self.agent_id, self.agent = enrolled["agent"]["id"], enrolled["credential"]["token"]
        self.credential = self.f.root / "agent.json"
        self.write(self.credential, enrolled["credential"])
        self.episode = self.f.store.call("POST", "/v1/practice/episodes",
                                       {"request_id": uuid.uuid4().hex}, self.f.owner)[1]["id"]
        self.base = "/v1/practice/episodes/" + self.episode
        self.f.store.call("POST", self.base + "/accounts",
                          {"request_id": uuid.uuid4().hex, "agent_id": self.agent_id,
                           "model_pipeline_sha256": "a" * 64}, self.operator)
        self.scope_path = self.f.root / "scope.json"
        self.scope = {"version": 1, "experiment_id": uuid.uuid4().hex, "episode_id": self.episode,
                      "agent_id": self.agent_id,
                      "instance_id": self.f.store.call("GET", "/v1/status")[1]["instance_id"],
                      "model": "synthetic-fixture", "model_pipeline_sha256": "a" * 64,
                      "created_at_ms": now_ms() - 1000, "expires_at_ms": now_ms() + 3_600_000,
                      "max_decisions": 3, "max_buy_micro": 10_000_000}
        self.write(self.scope_path, self.scope)
        self.journal = self.f.root / "experiment"
        self.server = WSGIServer(self.f.store, 0)
        self.thread = threading.Thread(target=self.server.serve_forever)
        self.thread.start()
        self.addCleanup(self.stop)

    @staticmethod
    def write(path, value):
        path.write_text(canonical(value), encoding="utf-8")
        path.chmod(0o600)

    def stop(self):
        self.server.shutdown()
        self.thread.join(10)
        self.assertFalse(self.thread.is_alive())

    def model(self, action=None):
        decision = action or {"side": "HOLD", "coin_id": "", "amount": 0, "min_output": 0,
                              "note": "Synthetic protocol fixture abstains."}
        fixture = ModelFixture(actions=[{"action": "paper_decision", "arguments": decision}]).start()
        self.addCleanup(fixture.stop)
        return fixture

    def buy(self):
        coin = self.f.store.call("GET", self.base, token=self.agent)[1]["market"]["coins"][0]
        return {"side": "BUY", "coin_id": coin["id"], "amount": 1_000_000, "min_output": 1,
                "note": "Synthetic order to verify accounting, not financial skill."}

    def run_worker(self, fixture, **kwargs):
        return run_practice(self.credential, self.scope_path, self.journal, model="synthetic-fixture",
                            port=self.server.server_port, model_port=fixture.port, **kwargs)

    def account(self):
        return self.f.store.call("GET", self.base + "/accounts/" + self.agent_id, token=self.agent)[1]

    def step(self, tick=0):
        self.f.store.call("POST", self.base + "/step",
                          {"request_id": uuid.uuid4().hex, "expected_tick": tick}, self.f.owner)

    def assert_code(self, code, function):
        with self.assertRaises(Problem) as caught:
            function()
        self.assertEqual(caught.exception.code, code)

    def test_hold_seals_observation_and_decision_once_without_market_write(self):
        fixture = self.model()
        before = self.account()
        self.assertEqual(self.run_worker(fixture)["state"], "HOLD_RECORDED")
        self.assertEqual(self.run_worker(fixture)["state"], "ALREADY_OBSERVED_NO_NEW_INFERENCE")
        self.assertEqual(len(fixture.requests), 2)
        self.assertEqual(before, self.account())
        report = practice_summary(self.journal)
        self.assertEqual(report["counts"]["HOLD"], 1)
        self.assertEqual(report["model_training"], "NOT_PERFORMED")
        self.assertFalse(report["live_execution_allowed"])

    def test_model_has_one_tool_no_credentials_no_future_labels_or_host_controls(self):
        fixture = self.model()
        self.run_worker(fixture)
        chat = [body for path, body in fixture.requests if path == "/api/chat"][0]
        self.assertEqual([t["function"]["name"] for t in chat["tools"]], ["paper_decision"])
        raw = canonical(fixture.requests)
        for secret in (self.agent, self.operator, self.f.owner):
            self.assertNotIn(secret, raw)
        observed = json.loads(chat["messages"][1]["content"])["observed_snapshot"]
        self.assertEqual(observed["tick"], 0)
        self.assertEqual(len(observed["market"]["coins"]), 4)
        for forbidden in ("secret", '"mode"', '"turn"', "future_events"):
            self.assertNotIn(forbidden, canonical(observed))
        self.assertNotIn("credential_id", canonical(observed))

    def test_order_remains_pending_then_reconciles_without_second_inference(self):
        self.scope["max_decisions"] = 1
        self.write(self.scope_path, self.scope)
        fixture = self.model(self.buy())
        first = self.run_worker(fixture)
        self.assertEqual(first["state"], "ORDER_ACCEPTED_PENDING")
        self.assertEqual(self.account()["gas_micro"], 1000)
        self.assertEqual(self.run_worker(fixture)["state"], "WAITING_FOR_OWNER_TICK")
        self.step()
        self.assertEqual(self.run_worker(fixture)["state"], "EXPERIMENT_DECISION_LIMIT")
        self.assertEqual(len(fixture.requests), 2)
        summary = practice_summary(self.journal)
        self.assertEqual(summary["counts"]["FILLED"] + summary["counts"]["REJECTED"], 1)
        self.assertEqual(summary["counts"]["UNRESOLVED"], 0)
        self.assertEqual(self.account()["order_count"], 1)
        self.assertEqual(self.f.store.audit()["database_integrity"], "OK")

    def test_lost_ack_after_server_commit_is_read_reconciled_with_one_gas_debit(self):
        fixture = self.model(self.buy())
        original = Client.request
        posts = []

        def lose(client, method, route, body=None, token=None):
            response = original(client, method, route, body, token)
            if method == "POST" and route.endswith("/orders"):
                posts.append(canonical(body))
                raise ConnectionResetError("synthetic lost acknowledgment after durable commit")
            return response

        with patch.object(Client, "request", lose):
            self.assertEqual(self.run_worker(fixture)["state"], "DELIVERY_UNCERTAIN")
        self.assertEqual(self.run_worker(fixture)["state"], "WAITING_FOR_OWNER_TICK")
        self.assertEqual(len(posts), 1)
        self.assertEqual(self.account()["gas_micro"], 1000)
        self.assertEqual(len(fixture.requests), 2)

    def test_crash_after_decision_before_post_resends_same_identity_without_inference(self):
        fixture = self.model(self.buy())
        with patch("zoora_community.practice_worker.send_order", side_effect=SystemExit(88)):
            with self.assertRaises(SystemExit):
                self.run_worker(fixture)
        self.assertEqual(self.account()["gas_micro"], 0)
        result = self.run_worker(fixture)
        self.assertEqual(result["state"], "ORDER_ACCEPTED_PENDING")
        self.assertEqual(len(fixture.requests), 2)
        self.assertEqual(self.account()["order_count"], 1)

    def test_crash_before_decision_abstains_instead_of_sampling_model_again(self):
        fixture = self.model()
        with patch.object(LocalModel, "inspect", side_effect=SystemExit(88)):
            with self.assertRaises(SystemExit):
                self.run_worker(fixture)
        self.assertEqual(self.run_worker(fixture)["state"], "ALREADY_OBSERVED_NO_NEW_INFERENCE")
        self.assertEqual(fixture.requests, [])
        failure = json.loads((self.journal / "tick-000-failure.json").read_bytes())
        self.assertEqual(failure["error"], "INFERENCE_INTERRUPTED_ABSTAIN")

    def test_owner_advancing_during_inference_rejects_stale_decision_before_order(self):
        fixture = self.model(self.buy())
        original = LocalModel.next_action

        def advance(provider, *args, **kwargs):
            result = original(provider, *args, **kwargs)
            self.step()
            return result

        with patch.object(LocalModel, "next_action", advance):
            self.assert_code("PRACTICE_SNAPSHOT_CHANGED", lambda: self.run_worker(fixture))
        self.assertEqual(self.account()["order_count"], 0)

    def test_stop_during_inference_blocks_dispatch_and_preserves_failed_evidence(self):
        fixture = self.model(self.buy())
        stop = self.f.root / "STOP"
        original = LocalModel.next_action

        def stopped(provider, *args, **kwargs):
            result = original(provider, *args, **kwargs)
            stop.touch()
            return result

        with patch.object(LocalModel, "next_action", stopped):
            self.assert_code("PRACTICE_WORKER_STOPPED", lambda: self.run_worker(fixture, stop_file=stop))
        self.assertEqual(self.account()["gas_micro"], 0)
        self.assertTrue((self.journal / "tick-000-failure.json").exists())

    def test_changed_scope_during_inference_blocks_dispatch(self):
        fixture = self.model(self.buy())
        original = LocalModel.next_action

        def change(provider, *args, **kwargs):
            result = original(provider, *args, **kwargs)
            revised = dict(self.scope, max_buy_micro=1)
            self.write(self.scope_path, revised)
            return result

        with patch.object(LocalModel, "next_action", change):
            self.assert_code("PRACTICE_SCOPE_CHANGED", lambda: self.run_worker(fixture))
        self.assertEqual(self.account()["order_count"], 0)

    def test_expired_future_boolean_and_oversized_scope_refused_before_network(self):
        fixture = self.model()
        variants = [dict(self.scope, expires_at_ms=now_ms() - 1),
                    dict(self.scope, created_at_ms=now_ms() + 100_000),
                    dict(self.scope, max_decisions=True), dict(self.scope, max_buy_micro=250_000_001)]
        with patch.object(Client, "request", side_effect=AssertionError("network must not run")):
            for variant in variants:
                self.write(self.scope_path, variant)
                with self.assertRaises(Problem):
                    self.run_worker(fixture)
        self.assertEqual(fixture.requests, [])

    def test_pipeline_model_and_agent_binding_mismatches_do_not_infer(self):
        fixture = self.model()
        self.scope["model_pipeline_sha256"] = "b" * 64
        self.write(self.scope_path, self.scope)
        self.assert_code("PRACTICE_SCOPE_BINDING_MISMATCH", lambda: self.run_worker(fixture))
        self.assertEqual(fixture.requests, [])

    def test_declared_model_must_match_host_scope(self):
        fixture = self.model()
        self.scope["model"] = "other-local-model"
        self.write(self.scope_path, self.scope)
        self.assert_code("PRACTICE_MODEL_SCOPE_MISMATCH", lambda: self.run_worker(fixture))
        self.assertEqual(fixture.requests, [])

    def test_invalid_minimum_and_buy_budget_fail_without_server_debit(self):
        for change in ({"min_output": 0}, {"amount": 10_000_001}, {"amount": True}):
            with self.subTest(change=change):
                fixture = self.model({**self.buy(), **change})
                self.journal = self.f.root / uuid.uuid4().hex
                with self.assertRaises(Problem):
                    self.run_worker(fixture)
                self.assertEqual(self.account()["order_count"], 0)

    def test_unsupported_shell_and_plain_text_are_not_market_decisions(self):
        for action in ({"action": "shell", "arguments": {"command": "echo denied"}},
                       {"action": "finish", "arguments": {"output": "Buy anything"}}):
            fixture = ModelFixture(actions=[action]).start()
            self.addCleanup(fixture.stop)
            self.journal = self.f.root / uuid.uuid4().hex
            with self.assertRaises(Problem):
                self.run_worker(fixture)
        self.assertEqual(self.account()["gas_micro"], 0)

    def test_revoked_credential_after_inference_cannot_submit(self):
        fixture = self.model(self.buy())
        original = LocalModel.next_action

        def revoke(provider, *args, **kwargs):
            result = original(provider, *args, **kwargs)
            self.f.store.call("POST", "/v1/agents/" + self.agent_id + "/credentials", {}, self.operator)
            return result

        with patch.object(LocalModel, "next_action", revoke):
            self.assert_code("UNAUTHORIZED", lambda: self.run_worker(fixture))
        account = self.f.store.call("GET", self.base + "/accounts/" + self.agent_id, token=self.operator)[1]
        self.assertEqual(account["order_count"], 0)

    def test_evidence_write_failure_prevents_post(self):
        fixture = self.model(self.buy())
        original = Journal.save

        def disk_full(journal, name, value):
            if name.endswith("-decision.json"):
                raise OSError("synthetic full disk")
            return original(journal, name, value)

        with patch.object(Journal, "save", disk_full):
            self.assert_code("PRACTICE_INFERENCE_FAILED", lambda: self.run_worker(fixture))
        self.assertEqual(self.account()["order_count"], 0)

    def test_independent_review_detects_observation_and_receipt_tampering(self):
        fixture = self.model(self.buy())
        self.run_worker(fixture)
        path = self.journal / "tick-000-observation.json"
        original = path.read_bytes()
        changed = json.loads(original)
        changed["snapshot"]["account"]["cash_micro"] += 1
        self.write(path, changed)
        self.assert_code("PRACTICE_OBSERVATION_MISMATCH", lambda: practice_summary(self.journal))
        path.write_bytes(original)
        acknowledgment = self.journal / "tick-000-acceptance.json"
        changed = json.loads(acknowledgment.read_bytes())
        changed["result"]["amount"] += 1
        self.write(acknowledgment, changed)
        self.assert_code("PRACTICE_RECEIPT_MISMATCH", lambda: practice_summary(self.journal))

    def test_restart_refuses_changed_scope_and_unknown_journal_files(self):
        fixture = self.model()
        self.run_worker(fixture)
        self.scope["max_decisions"] = 4
        self.write(self.scope_path, self.scope)
        self.assert_code("PRACTICE_MANIFEST_MISMATCH", lambda: self.run_worker(fixture))
        (self.journal / "unknown.json").write_text("{}")
        self.assert_code("PRACTICE_JOURNAL_UNKNOWN_FILE", lambda: practice_summary(self.journal))

    def test_exclusive_lock_rejects_overlap_and_releases_after_process_death(self):
        fixture = self.model()
        self.run_worker(fixture)
        with Journal(self.journal).locked():
            self.assert_code("PRACTICE_WORKER_BUSY_OR_STORAGE_UNAVAILABLE",
                             lambda: self.run_worker(fixture))
        program = ("import os,sys;from zoora_community.practice_journal import Journal;"
                   "context=Journal(sys.argv[1]).locked();context.__enter__();os._exit(88)")
        child = subprocess.run([sys.executable, "-c", program, str(self.journal)],
                               capture_output=True, text=True, timeout=15)
        self.assertEqual(child.returncode, 88, child.stderr)
        with Journal(self.journal).locked():
            pass

    def test_cli_and_offline_review_hash_actual_saved_bytes_and_redact_credentials(self):
        fixture = self.model()
        args = [sys.executable, "-bb", "-X", "dev", "-W", "error", "-m", "zoora_community",
                "practice-step", "--credential-file", str(self.credential), "--scope-file", str(self.scope_path),
                "--journal-dir", str(self.journal), "--model", "synthetic-fixture",
                "--port", str(self.server.server_port), "--model-port", str(fixture.port)]
        completed = subprocess.run(args, capture_output=True, text=True, timeout=30)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(json.loads(completed.stdout)["state"], "HOLD_RECORDED")
        output = self.f.root / "review.json"
        reviewed = subprocess.run([sys.executable, "-m", "zoora_community", "practice-review",
                                   "--journal-dir", str(self.journal), "--out", str(output)],
                                  capture_output=True, text=True, timeout=15)
        self.assertEqual(reviewed.returncode, 0, reviewed.stderr)
        self.assertEqual(json.loads(reviewed.stdout)["report_sha256"], hashlib.sha256(output.read_bytes()).hexdigest())
        self.assertNotIn(self.agent, completed.stdout + completed.stderr + reviewed.stdout + reviewed.stderr)
        with self.assertRaises(FileExistsError):
            review_practice(self.journal, output)
