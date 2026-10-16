"""Host-selected orders, actual provider TLS, local model protocol and durable jobs."""

from contextlib import closing
import copy
import hashlib
import http.client
import json
import math
import sqlite3
import time
import unittest
from unittest.mock import patch

from test_payment_pipeline import LocalAPI, PipelineCase
import test_agent_runner as runner_support
from test_commerce_store import fixture_policy, purchase_command
from bridge_fixture import KEY, ProviderFixture, intent
from zoora_community import payment_recovery
from zoora_community.agent_payments import SandboxPaymentSession, configuration, scope_value
from zoora_community.agent_runner import LocalModel, run_agent
from zoora_community.bridge_sandbox import BridgeSandboxClient
from zoora_community.job_worker import work_jobs
from zoora_community.payment_pipeline import PaymentPipeline
from zoora_community.validation import Problem, canonical


class AgentPaymentSessionTests(PipelineCase):
    def setUp(self):
        super().setUp()
        self.key = self.stage()["order_id"]
        self.key_file, self.scope_file = self.folder / "key", self.folder / "scope.json"
        self.key_file.write_text(KEY)
        self.key_file.chmod(0o600)
        self.scope = {"instance_id": self.mandate["instance_id"], "agent_id": self.agent_id,
            "order_ids": [self.key], "max_advances": 1, "expires_at_ms": self.f.at + 600_000}
        self.save_scope()
        self.principal = self.api.request("GET", "/v1/me", token=self.agent)[1]

    def save_scope(self):
        self.scope_file.write_text(canonical(self.scope))
        self.scope_file.chmod(0o600)

    def session(self, *, bind=True, guard=None, deadline=None):
        session = SandboxPaymentSession(self.pipeline.state, self.key_file, self.scope_file)
        session.pipeline = self.pipeline  # Fixture clock; no test clock exists in shipped CLI.
        if bind:
            session.bind(self.api, self.agent, self.principal, deadline or time.monotonic() + 30, guard)
        return session

    def advance(self, session, key=None, **extra):
        return session.run_tool({"action": "sandbox_payment_advance", "arguments": {"order_id": key or self.key, **extra}})

    def test_status_exposes_only_selected_orders_and_no_provider_or_credential_context(self):
        self.stage(self.purchase(2))
        session = self.session()
        value = session.run_tool({"action": "sandbox_payment_status", "arguments": {}})
        self.assertEqual([r["order_id"] for r in value["orders"]], [self.key])
        self.assertEqual(value["remaining_advances"], 1)
        self.assertEqual(session.advances, 0)
        for secret in (KEY, self.agent, self.operator, self.mandate["customer_id"], self.mandate["source_address"]):
            self.assertNotIn(secret, canonical(value))
        self.assertEqual(self.provider.requests, [])

    def test_advance_uses_saved_amount_body_and_actor_and_retains_a_redacted_receipt(self):
        session = self.session()
        receipt = self.advance(session)
        self.assertEqual(receipt["phase"], "PROVIDER_OBSERVED")
        self.assertEqual(receipt["provider_state"], "awaiting_funds")
        self.assertFalse(receipt["real_funds_authorized"])
        self.assertEqual([r["method"] for r in self.provider.requests], ["GET", "POST"])
        self.assertEqual(json.loads(self.provider.requests[1]["body"])["amount"], "1.000000")
        self.assertEqual(session.evidence()["advances_attempted"], 1)
        self.assertEqual(session.evidence()["outcomes"], [receipt])
        self.assertNotIn("idempotency_key", receipt)
        self.assertNotIn(KEY, canonical(session.evidence()))

    def test_model_cannot_add_or_change_amount_recipient_key_or_transfer_id(self):
        session = self.session()
        for field in ("amount_usdc", "destination_address", "api_key", "transfer_id", "url"):
            with self.assertRaises(Problem):
                self.advance(session, **{field: "untrusted"})
        self.assertEqual(session.advances, 0)
        self.assertEqual(self.provider.requests, [])

    def test_an_owned_order_outside_the_host_allowlist_cannot_be_advanced(self):
        other = self.stage(self.purchase(2))["order_id"]
        session = self.session()
        self.error("AGENT_PAYMENT_ORDER_NOT_AUTHORIZED", lambda: self.advance(session, other))
        self.assertEqual(session.advances, 0)
        self.assertEqual(self.provider.requests, [])

    def test_foreign_agent_order_in_host_scope_is_refused_before_any_provider_call(self):
        other = self.stage(self.purchase(2, token=self.second), self.second)["order_id"]
        self.scope["order_ids"] = [other]
        self.save_scope()
        self.error("AGENT_PAYMENT_ORDER_NOT_AUTHORIZED", self.session)
        self.assertEqual(self.provider.requests, [])

    def test_foreign_instance_or_agent_scope_is_refused(self):
        for field in ("instance_id", "agent_id"):
            changed = copy.deepcopy(self.scope)
            changed[field] = "f" * 32
            self.scope_file.write_text(canonical(changed))
            self.error("AGENT_PAYMENT_SCOPE_MISMATCH", self.session)
        self.assertEqual(self.provider.requests, [])

    def test_scope_rejects_duplicates_unknown_fields_unbounded_lists_and_noninteger_limits(self):
        variants = [{**self.scope, "order_ids": []}, {**self.scope, "order_ids": [self.key] * 2},
            {**self.scope, "order_ids": [f"{i:032x}" for i in range(9)]}, {**self.scope, "max_advances": True},
            {**self.scope, "max_advances": 3}, {**self.scope, "max_advances": 0},
            {**self.scope, "expires_at_ms": 0}, {**self.scope, "recipient": "untrusted"}]
        for value in variants:
            with self.assertRaises(Problem):
                scope_value(value)

    def test_scope_normalization_is_stable_and_later_file_edits_do_not_expand_a_running_session(self):
        other = self.stage(self.purchase(2))["order_id"]
        session = self.session()
        self.scope["order_ids"].append(other)
        self.save_scope()
        self.error("AGENT_PAYMENT_ORDER_NOT_AUTHORIZED", lambda: self.advance(session, other))
        self.assertEqual(session.scope["order_ids"], [self.key])

    def test_default_is_disabled_and_partial_configuration_is_rejected(self):
        self.assertIsNone(configuration(None, None, None))
        values = (self.pipeline.state, self.key_file, self.scope_file)
        for absent in range(3):
            config = list(values)
            config[absent] = None
            self.error("AGENT_PAYMENT_CONFIGURATION_REQUIRED", lambda config=config: configuration(*config))

    def test_expired_scope_or_run_deadline_fails_before_provider_http(self):
        self.scope["expires_at_ms"] = self.f.at
        self.save_scope()
        self.error("AGENT_PAYMENT_SCOPE_EXPIRED", self.session)
        self.scope["expires_at_ms"] += 1
        self.save_scope()
        self.error("RUN_DEADLINE", lambda: self.session(deadline=time.monotonic() - 1))
        self.assertEqual(self.provider.requests, [])

    def test_run_allowance_is_not_refunded_and_repeat_of_known_order_is_get_only(self):
        self.scope["max_advances"] = 2
        self.save_scope()
        session = self.session()
        self.advance(session)
        self.advance(session)
        self.error("AGENT_PAYMENT_ADVANCE_LIMIT", lambda: self.advance(session))
        self.assertEqual([r["method"] for r in self.provider.requests], ["GET", "POST", "GET"])
        self.assertEqual(len(self.provider.effects), 1)

    def test_provider_preflight_block_fails_the_action_and_keeps_admission_and_evidence(self):
        self.provider.customer["status"] = "paused"
        session = self.session()
        self.error("AGENT_PAYMENT_REQUIRES_REVIEW", lambda: self.advance(session))
        self.assertEqual(session.advances, 1)
        self.assertEqual(session.outcomes[0]["phase"], "PREFLIGHT_BLOCKED")
        self.assertEqual(self.pipeline.show()["admitted_principal_usdc"], "1.000000")
        self.assertEqual([r["method"] for r in self.provider.requests], ["GET"])

    def test_lost_post_reply_stays_uncertain_and_a_second_session_cannot_retry_the_post(self):
        self.provider.mode = "drop"
        session = self.session()
        self.error("AGENT_PAYMENT_REQUIRES_REVIEW", lambda: self.advance(session))
        self.assertEqual(session.outcomes[0]["phase"], "PROVIDER_UNKNOWN")
        self.provider.mode = "ok"
        again = self.session()
        self.error("AGENT_PAYMENT_REQUIRES_REVIEW", lambda: self.advance(again))
        self.assertEqual(again.outcomes[0]["phase"], "RECONCILIATION_REQUIRED")
        self.assertEqual(again.outcomes[0]["candidate_count"], 1)
        self.assertNotIn("candidate_ids", again.outcomes[0])
        self.assertEqual([r["method"] for r in self.provider.requests], ["GET", "POST", "GET"])
        self.assertEqual(len(self.provider.effects), 1)

    def test_scope_expiry_after_preflight_blocks_http_create_and_retains_the_claimed_uncertainty(self):
        self.scope["expires_at_ms"] = self.f.at + 1
        self.save_scope()
        session = self.session()
        original = BridgeSandboxClient.preflight
        def expire(client, customer):
            value = original(client, customer)
            self.f.at = self.scope["expires_at_ms"]
            return value
        with patch.object(BridgeSandboxClient, "preflight", expire):
            self.error("AGENT_PAYMENT_SCOPE_EXPIRED", lambda: self.advance(session))
        self.assertEqual([r["method"] for r in self.provider.requests], ["GET"])
        self.assertEqual(self.pipeline.bridge.show(self.key)["attempts"], 1)
        self.assertEqual(session.outcomes[0]["phase"], "PROVIDER_UNKNOWN")

    def test_stop_after_preflight_prevents_create_without_network_under_sql_locks(self):
        stopped = False
        def guard(_deadline):
            if stopped:
                raise Problem(409, "JOB_STOPPED")
            for path in (self.pipeline.path, self.pipeline.bridge.path):
                if path.exists():
                    with closing(sqlite3.connect(path, timeout=.1, autocommit=True)) as connection:
                        connection.execute("BEGIN IMMEDIATE")
                        connection.execute("ROLLBACK")
        session = self.session(guard=guard)
        original = BridgeSandboxClient.preflight
        def stop(client, customer):
            nonlocal stopped
            value = original(client, customer)
            stopped = True
            return value
        with patch.object(BridgeSandboxClient, "preflight", stop):
            self.error("JOB_STOPPED", lambda: self.advance(session))
        self.assertEqual([r["method"] for r in self.provider.requests], ["GET"])
        self.assertEqual(self.pipeline.bridge.show(self.key)["last_attempt_error"], "BRIDGE_HOST_GUARD_REJECTED")

    def test_pipeline_revocation_during_preflight_still_fences_the_create(self):
        session = self.session()
        original = BridgeSandboxClient.preflight
        def revoke(client, customer):
            value = original(client, customer)
            self.pipeline.revoke(self.api, self.operator)
            return value
        with patch.object(BridgeSandboxClient, "preflight", revoke):
            self.error("AGENT_PAYMENT_REQUIRES_REVIEW", lambda: self.advance(session))
        self.assertEqual(session.outcomes[0]["code"], "PIPELINE_MANDATE_REVOKED")
        self.assertEqual([r["method"] for r in self.provider.requests], ["GET"])

    def test_lost_guard_connection_before_create_keeps_uncertainty_and_redacts_transport_details(self):
        session = self.session()
        original_preflight, original_check = BridgeSandboxClient.preflight, session._check_run
        disconnected = False
        def preflight(client, customer):
            nonlocal disconnected
            value = original_preflight(client, customer)
            disconnected = True
            return value
        def check():
            if disconnected:
                raise http.client.RemoteDisconnected("PRIVATE AUTH TRANSPORT DETAIL")
            return original_check()
        with patch.object(BridgeSandboxClient, "preflight", preflight), patch.object(session, "_check_run", check):
            self.error("RUN_AUTH_UNAVAILABLE", lambda: self.advance(session))
        self.assertEqual([r["method"] for r in self.provider.requests], ["GET"])
        self.assertEqual(self.pipeline.bridge.show(self.key)["last_attempt_error"], "BRIDGE_HOST_GUARD_REJECTED")
        self.assertEqual(session.outcomes[0]["phase"], "PROVIDER_UNKNOWN")
        self.assertNotIn("PRIVATE", canonical(session.evidence()))

    def test_credential_revocation_between_bind_and_tool_prevents_any_provider_request(self):
        session = self.session()
        self.f.store.call("PATCH", "/v1/agents/" + self.agent_id, {"active": False}, self.operator)
        with self.assertRaises(Problem):
            self.advance(session)
        self.assertEqual(self.provider.requests, [])
        self.assertEqual(session.advances, 0)

    def test_recovery_only_queue_cannot_be_enabled_as_an_agent_tool(self):
        backup = self.folder / "recovery.zip"
        saved = payment_recovery.create_backup(self.pipeline, backup)
        restored = PaymentPipeline(self.folder / "restored", clock=self.pipeline.clock)
        payment_recovery.restore_backup(restored, backup, saved["backup_sha256"])
        session = self.session(bind=False)
        session.pipeline = restored
        self.error("PIPELINE_RESTORED_READ_ONLY", lambda: session.bind(self.api, self.agent, self.principal, time.monotonic() + 10))
        self.assertEqual(self.provider.requests, [])

    def test_bound_session_cannot_be_rebound_to_another_client_or_identity(self):
        session = self.session()
        self.error("AGENT_PAYMENT_SESSION_ALREADY_BOUND", lambda: session.bind(self.api, self.second, self.principal, time.monotonic() + 10))

    def test_transport_host_deadline_and_guard_settings_are_strict_and_expiry_prevents_http(self):
        for deadline in (True, 0, -1, math.inf, math.nan, "private"):
            self.error("BRIDGE_HOST_DEADLINE_REJECTED", lambda deadline=deadline: BridgeSandboxClient(KEY, deadline=deadline))
        self.error("BRIDGE_HOST_GUARD_REJECTED", lambda: BridgeSandboxClient(KEY, guard="untrusted"))
        expired = BridgeSandboxClient(KEY, deadline=time.monotonic() - 1)
        self.error("BRIDGE_TIMEOUT", lambda: expired.preflight(self.mandate["customer_id"]))
        self.assertEqual(self.provider.requests, [])


class AgentPaymentRunnerTests(unittest.TestCase):
    stop_server = runner_support.RunnerTests.stop_server
    model = runner_support.RunnerTests.model

    def setUp(self):
        runner_support.RunnerTests.setUp(self)
        self.provider = ProviderFixture()
        serving = self.provider.serve()
        serving.__enter__()
        self.addCleanup(serving.__exit__, None, None, None)
        transport = self.provider.transport()
        transport.__enter__()
        self.addCleanup(transport.__exit__, None, None, None)
        api = LocalAPI(self.f)
        policy = fixture_policy()
        policy["authority"]["agents"] = ["agent_one"]
        policy["authority"].update(payment_budget=10, fee_budget=100, expires=900_000)
        policy["routes"][0]["eligible_until"] = 900_000
        self.book = api.request("POST", "/v1/commerce/books", {"request_id": "a" * 32, "policy": policy,
            "bindings": [{"alias": "agent_one", "agent_id": self.agent_id}]}, self.operator)[1]["book"]
        purchase = api.request("POST", "/v1/commerce/books/" + self.book["id"] + "/actions", {
            "request_id": "c" * 32, "command": purchase_command(1, amount=1, fee_cap=1, expires=800_000)}, self.agent)[1]
        record = purchase["book"]["state"]["purchases"][0]
        source = api.request("GET", "/v1/status")[1]
        mandate = {"mandate_id": "b" * 32, "environment": "BRIDGE_SANDBOX", "real_funds_authorized": False,
            "instance_id": source["instance_id"], "operator_id": self.operator_id, "agents": [self.agent_id],
            "customer_id": intent()["customer_id"], "source_address": intent()["source_address"],
            "merchants": [{"merchant": "supplier", "destination_address": intent()["destination_address"], "activities": ["api_service"]}],
            "payment_limit_usdc": "2", "admission_budget_usdc": "4", "valid_from_ms": self.f.at - 1000,
            "expires_ms": self.f.at + 900_000}
        self.pipeline = PaymentPipeline(self.f.root / "pipeline")
        self.pipeline.initialize(mandate, api, self.operator)
        self.key = self.pipeline.stage({"book_id": self.book["id"], "purchase_id": "0" * 31 + "1",
            "commerce_binding_sha256": record["binding_sha256"], "amount_usdc": "1.250001"}, api, self.agent)["order_id"]
        self.key_file, self.scope_file = self.f.root / "key", self.f.root / "scope.json"
        self.key_file.write_text(KEY)
        self.key_file.chmod(0o600)
        self.scope = {"instance_id": source["instance_id"], "agent_id": self.agent_id,
            "order_ids": [self.key], "max_advances": 1, "expires_at_ms": self.f.at + 600_000}
        self.scope_file.write_text(canonical(self.scope))
        self.scope_file.chmod(0o600)
        self.options = {"payment_state": self.pipeline.state, "sandbox_key_file": self.key_file,
                        "payment_scope_file": self.scope_file}

    def actions(self):
        return [{"action": "sandbox_payment_status", "arguments": {}},
                {"action": "sandbox_payment_advance", "arguments": {"order_id": self.key}},
                {"action": "finish", "arguments": {"output": "Sandbox instruction observed; settlement unavailable."}}]

    def run_model(self, fixture, *, enabled=True, **options):
        return run_agent(self.credential, self.task, self.out, model="synthetic-fixture",
            port=self.server.server_port, model_port=fixture.port, **(self.options if enabled else {}), **options)

    def test_opt_in_model_tools_preserve_private_report_hash_and_do_not_leak_host_secrets(self):
        fixture = self.model(actions=self.actions())
        result = self.run_model(fixture, project_id=self.project)
        report = json.loads(self.out.read_bytes())
        self.assertEqual(result["steps"], 3)
        self.assertEqual(report["sandbox_payments"]["advances_attempted"], 1)
        self.assertEqual(report["sandbox_payments"]["outcomes"][0]["phase"], "PROVIDER_OBSERVED")
        self.assertEqual(result["report_sha256"], hashlib.sha256(self.out.read_bytes()).hexdigest())
        self.assertEqual(len(fixture.requests[1][1]["tools"]), 6)
        messages = canonical(fixture.requests)
        for secret in (KEY, self.agent, self.operator, self.pipeline._config()["customer_id"]):
            self.assertNotIn(secret, messages + self.out.read_text())
        self.assertEqual(len(self.provider.effects), 1)
        artifact = self.client.request("GET", "/v1/projects/" + self.project + "/artifacts")[1]["items"][0]
        self.assertEqual(artifact["digest"], result["report_sha256"])

    def test_payment_tool_call_without_host_opt_in_is_refused_and_retains_failed_report(self):
        fixture = self.model(actions=self.actions())
        with self.assertRaises(Problem) as caught:
            self.run_model(fixture, enabled=False)
        self.assertEqual(caught.exception.code, "TOOL_NOT_ALLOWED")
        self.assertEqual(json.loads(self.out.read_bytes())["state"], "FAILED")
        self.assertEqual(len(fixture.requests[1][1]["tools"]), 4)
        self.assertEqual(self.provider.requests, [])

    def test_ordinary_tools_stay_available_under_an_enabled_host_scope(self):
        fixture = self.model()
        self.run_model(fixture)
        report = json.loads(self.out.read_bytes())
        self.assertEqual(report["steps"][0]["tool_result"]["words"], 2)
        self.assertEqual(report["sandbox_payments"]["advances_attempted"], 0)
        self.assertEqual(self.provider.requests, [])

    def test_wrong_scope_fails_before_any_model_inference_and_saves_bound_diagnostics(self):
        self.scope["agent_id"] = "f" * 32
        self.scope_file.write_text(canonical(self.scope))
        fixture = self.model(actions=self.actions())
        with self.assertRaises(Problem) as caught:
            self.run_model(fixture)
        self.assertEqual(caught.exception.code, "AGENT_PAYMENT_SCOPE_MISMATCH")
        self.assertEqual(fixture.requests, [])
        self.assertEqual(json.loads(self.out.read_bytes())["sandbox_payments"]["advances_attempted"], 0)

    def test_last_step_cannot_invoke_a_payment_tool(self):
        fixture = self.model(actions=self.actions())
        with self.assertRaises(Problem) as caught:
            self.run_model(fixture, max_steps=2)
        self.assertEqual(caught.exception.code, "RUN_STEP_LIMIT")
        self.assertEqual(self.provider.requests, [])

    def test_credential_revocation_while_model_responds_prevents_the_payment_tool(self):
        fixture = self.model(actions=self.actions())
        original = LocalModel.next_action
        def revoke(model, *args, **kwargs):
            value = original(model, *args, **kwargs)
            if value[0]["action"] == "sandbox_payment_advance":
                self.f.store.call("PATCH", "/v1/agents/" + self.agent_id, {"active": False}, self.operator)
            return value
        with patch.object(LocalModel, "next_action", revoke), self.assertRaises(Problem):
            self.run_model(fixture)
        self.assertEqual(self.provider.requests, [])
        self.assertEqual(json.loads(self.out.read_bytes())["state"], "FAILED")

    def test_stop_after_model_response_prevents_tool_execution(self):
        fixture = self.model(actions=self.actions())
        original = LocalModel.next_action
        stopped = False
        def stop(model, *args, **kwargs):
            nonlocal stopped
            value = original(model, *args, **kwargs)
            stopped = value[0]["action"] == "sandbox_payment_advance"
            return value
        def guard(_deadline):
            if stopped:
                raise Problem(409, "JOB_STOPPED")
        with patch.object(LocalModel, "next_action", stop), self.assertRaises(Problem) as caught:
            self.run_model(fixture, _guard=guard)
        self.assertEqual(caught.exception.code, "JOB_STOPPED")
        self.assertEqual(self.provider.requests, [])
        self.assertEqual(self.pipeline.audit()["claims"], 0)

    def test_uncertain_payment_fails_the_model_task_and_preserves_redacted_receipt(self):
        self.provider.mode = "drop"
        fixture = self.model(actions=self.actions())
        with self.assertRaises(Problem) as caught:
            self.run_model(fixture)
        self.assertEqual(caught.exception.code, "AGENT_PAYMENT_REQUIRES_REVIEW")
        report = json.loads(self.out.read_bytes())
        self.assertEqual(report["state"], "FAILED")
        self.assertEqual(report["sandbox_payments"]["outcomes"][0]["phase"], "PROVIDER_UNKNOWN")
        self.assertEqual(len(self.provider.effects), 1)

    def test_queued_job_binds_scope_receipt_report_and_public_reference_without_repeating_work(self):
        job = self.client.request("POST", "/v1/jobs", {"request_id": "d" * 32, "title": "Sandbox task",
            "prompt": "Advance the host-selected order and report its sandbox state.", "project_id": self.project}, self.agent)[1]["job"]
        fixture = self.model(actions=self.actions())
        reports = self.f.root / "queued"
        result = work_jobs(self.credential, reports, model="synthetic-fixture", port=self.server.server_port,
                           model_port=fixture.port, **self.options)
        outcome = result["jobs"][0]
        raw = next(reports.glob("*.json")).read_bytes()
        report = json.loads(raw)
        self.assertEqual(outcome["state"], "SUCCEEDED")
        self.assertEqual(report["job"], {"job_id": job["id"], "attempt_id": outcome["attempt_id"]})
        self.assertEqual(outcome["report_sha256"], hashlib.sha256(raw).hexdigest())
        self.assertEqual(report["sandbox_payments"]["outcomes"][0]["order_id"], self.key)
        idle = work_jobs(self.credential, reports, model="synthetic-fixture", port=self.server.server_port,
                         model_port=fixture.port, **self.options)
        self.assertEqual(idle["processed"], 0)
        self.assertEqual(len(self.provider.effects), 1)
        self.assertEqual(len(fixture.requests), 4)

    def test_unknown_provider_result_marks_queued_job_failed_without_an_artifact(self):
        self.provider.mode = "drop"
        job = self.client.request("POST", "/v1/jobs", {"request_id": "d" * 32, "title": "Sandbox task",
            "prompt": "Advance the selected sandbox instruction.", "project_id": self.project}, self.agent)[1]["job"]
        fixture = self.model(actions=self.actions())
        result = work_jobs(self.credential, self.f.root / "queued", model="synthetic-fixture",
            port=self.server.server_port, model_port=fixture.port, **self.options)["jobs"][0]
        self.assertEqual(result["state"], "FAILED")
        self.assertEqual(result["error_code"], "AGENT_PAYMENT_REQUIRES_REVIEW")
        self.assertIsNone(result["artifact_id"])
        self.assertEqual(self.client.request("GET", "/v1/jobs/" + job["id"], token=self.agent)[1]["state"], "FAILED")
