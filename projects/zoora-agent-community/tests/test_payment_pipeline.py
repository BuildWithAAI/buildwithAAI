"""Cross-module purchase admission, shared limits, concurrent dispatch and GET-only recovery."""

from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
import copy
import json
from pathlib import Path
import sqlite3
import threading
import unittest
from unittest.mock import patch

from test_bridge_sandbox import SandboxCase
from bridge_fixture import KEY, intent
from helpers import Fixture
from test_commerce_store import fixture_policy, purchase_command
from zoora_community.bridge_sandbox import BridgeSandboxClient
from zoora_community.payment_contract import mandate_value, order_id, units
from zoora_community.payment_pipeline import LEASE_MS, PaymentPipeline
from zoora_community.validation import Problem, canonical


class LocalAPI:
    def __init__(self, fixture):
        self.fixture = fixture

    def request(self, method, path, body=None, token=None):
        return self.fixture.store.call(method, path, body, token)


class PipelineCase(SandboxCase):
    def setUp(self):
        super().setUp()
        self.f = Fixture()
        self.addCleanup(self.f.close)
        self.operator_id, self.operator = self.f.operator()
        self.agent_id, self.agent = self.f.agent(self.operator)
        self.second_id, self.second = self.f.agent(self.operator, "agent_two")
        self.api = LocalAPI(self.f)
        policy = fixture_policy()
        policy["authority"].update(payment_limit=100, payment_budget=1000, fee_budget=100, expires=900_000)
        for route in policy["routes"]:
            route["eligible_until"] = 900_000
        self.book = self.api.request("POST", "/v1/commerce/books", {"request_id": "a" * 32, "policy": policy,
            "bindings": [{"alias": "agent_one", "agent_id": self.agent_id},
                         {"alias": "agent_two", "agent_id": self.second_id}]}, self.operator)[1]["book"]
        self.route = "/v1/commerce/books/" + self.book["id"]
        self.mandate = {"mandate_id": "b" * 32, "environment": "BRIDGE_SANDBOX", "real_funds_authorized": False,
            "instance_id": self.api.request("GET", "/v1/status")[1]["instance_id"], "operator_id": self.operator_id,
            "agents": [self.agent_id, self.second_id], "customer_id": intent()["customer_id"],
            "source_address": intent()["source_address"],
            "merchants": [{"merchant": "supplier", "destination_address": intent()["destination_address"], "activities": ["api_service"]}],
            "payment_limit_usdc": "2", "admission_budget_usdc": "4", "valid_from_ms": self.f.at,
            "expires_ms": self.f.at + 900_000}
        self.pipeline = PaymentPipeline(self.folder / "pipeline", clock=lambda: self.f.at)
        self.pipeline.initialize(self.mandate, self.api, self.operator)

    def purchase(self, index=1, *, token=None, amount="1"):
        command = purchase_command(index, amount=1, fee_cap=1, expires=800_000)
        body = self.api.request("POST", self.route + "/actions", {"request_id": f"{index + 1000:032x}", "command": command}, token or self.agent)[1]
        if body["outcome"] != "AUTHORIZED":
            raise AssertionError(body["outcome"])
        record = next(r for r in body["book"]["state"]["purchases"] if r["request"]["quote"]["purchase_id"] == f"{index:032x}")
        return {"book_id": self.book["id"], "purchase_id": f"{index:032x}", "commerce_binding_sha256": record["binding_sha256"], "amount_usdc": amount}

    def stage(self, value=None, token=None):
        return self.pipeline.stage(value or self.purchase(), self.api, token or self.agent)

    def run_one(self, key, token=None):
        return self.pipeline.run_one(key, self.api, token or self.agent, self.client)


class PaymentPipelineTests(PipelineCase):
    def test_concurrent_provider_creation_is_rechecked_before_missing_history_denial(self):
        first = self.stage(self.purchase(1))["order_id"]
        second = self.stage(self.purchase(2))["order_id"]
        original = Path.exists
        interleaved = []

        def journal_created_between_checks(path):
            if path == self.pipeline.bridge.path and not interleaved:
                interleaved.append("started")
                interleaved.append(self.run_one(first))
                return False  # The first worker saw absence before the other's committed create.
            return original(path)

        with patch.object(Path, "exists", journal_created_between_checks):
            outcome = self.run_one(second)
        self.assertEqual(outcome["phase"], "PROVIDER_OBSERVED", outcome)
        self.assertEqual(interleaved[1]["phase"], "PROVIDER_OBSERVED")
        self.assertEqual(len(self.provider.effects), 2)
        self.assertEqual(self.pipeline.audit()["dispatch_fences"], 2)

    def test_connected_purchase_binds_actual_agent_commerce_and_provider_without_converting_units(self):
        envelope = self.purchase(amount="1.250001")
        queued = self.stage(envelope)
        before = self.api.request("GET", self.route, token=self.agent)[1]
        self.assertEqual(before["state"]["authority"]["totals"]["payment_reserved"], 1)
        observed = self.run_one(queued["order_id"])
        self.assertEqual(observed["phase"], "PROVIDER_OBSERVED")
        wire = self.provider.requests
        self.assertEqual([w["method"] for w in wire], ["GET", "POST"])
        self.assertEqual(json.loads(wire[1]["body"])["amount"], "1.250001")
        self.assertEqual(self.pipeline.show()["admitted_principal_usdc"], "1.250001")
        after = self.api.request("GET", self.route, token=self.agent)[1]
        self.assertEqual(after["state"]["authority"]["payments"][0]["state"], "IN_FLIGHT")
        self.assertEqual(after["state"]["accounting"]["net_settled_principal"], 0)
        self.assertEqual(after["state"]["authority"]["totals"]["payment_reserved"], 1)
        self.assertEqual(observed["settlement_accounting"], "UNAVAILABLE")
        self.f.store.audit()
        self.pipeline.audit()

    def test_stage_replay_has_one_admission_and_one_provider_intent(self):
        envelope = self.purchase()
        queued = self.stage(envelope)
        self.assertTrue(self.stage(envelope)["replayed"])
        self.run_one(queued["order_id"])
        self.assertTrue(self.stage(envelope)["replayed"])
        self.run_one(queued["order_id"])
        self.assertEqual([w["method"] for w in self.provider.requests], ["GET", "POST", "GET"])
        self.assertEqual(len(self.provider.effects), 1)
        self.assertEqual(self.pipeline.show()["admitted_principal_usdc"], "1.000000")

    def test_changing_amount_for_same_purchase_conflicts_without_another_admission(self):
        envelope = self.purchase()
        self.stage(envelope)
        self.error("PIPELINE_ORDER_CONFLICT", lambda: self.stage({**envelope, "amount_usdc": "2"}))
        self.assertEqual(self.pipeline.audit()["orders"], 1)
        self.assertEqual(self.provider.requests, [])

    def test_actual_agent_identity_cannot_be_replaced_by_another_book_member(self):
        envelope = self.purchase()
        self.error("PIPELINE_PURCHASE_AGENT_MISMATCH", lambda: self.stage(envelope, self.second))
        key = self.stage(envelope)["order_id"]
        self.error("PIPELINE_PURCHASE_AGENT_MISMATCH", lambda: self.run_one(key, self.second))
        self.assertEqual(self.pipeline.audit()["claims"], 0)

    def test_operator_cannot_impersonate_an_agent_to_stage_a_purchase(self):
        self.error("PIPELINE_WRONG_CREDENTIAL_ROLE", lambda: self.stage(self.purchase(), self.operator))

    def test_shared_usdc_admission_budget_is_atomic_across_two_agents(self):
        first, second = self.purchase(1, amount="2"), self.purchase(2, token=self.second, amount="2")
        third = self.purchase(3, amount="1")
        with ThreadPoolExecutor(max_workers=3) as pool:
            futures = [pool.submit(self.stage, first), pool.submit(self.stage, second, self.second), pool.submit(self.stage, third)]
            results = []
            for future in futures:
                try:
                    results.append(future.result())
                except Problem as error:
                    self.assertEqual(error.code, "PIPELINE_ADMISSION_BUDGET")
        total = units(self.pipeline.show()["admitted_principal_usdc"])
        self.assertLessEqual(total, 4_000_000)
        self.assertGreaterEqual(total, 3_000_000)
        self.assertEqual(len(results), 2)
        self.assertEqual(self.provider.requests, [])

    def test_pipeline_limit_is_separate_from_the_synthetic_commerce_budget(self):
        self.error("PIPELINE_PAYMENT_LIMIT", lambda: self.stage(self.purchase(amount="2.000001")))
        self.assertEqual(self.pipeline.audit()["orders"], 0)

    def test_missing_or_changed_purchase_binding_cannot_be_staged(self):
        envelope = self.purchase()
        self.error("PIPELINE_COMMERCE_BINDING_MISMATCH", lambda: self.stage({**envelope, "commerce_binding_sha256": "0" * 64}))
        self.error("PIPELINE_PURCHASE_NOT_FOUND", lambda: self.stage({**envelope, "purchase_id": "f" * 32}))

    def test_blocked_preflight_does_not_submit_commerce_or_create_a_transfer(self):
        key = self.stage()["order_id"]
        self.provider.customer["status"] = "paused"
        self.assertEqual(self.run_one(key)["phase"], "PREFLIGHT_BLOCKED")
        book = self.api.request("GET", self.route, token=self.agent)[1]
        self.assertEqual(book["state"]["authority"]["payments"][0]["state"], "AUTHORIZED")
        self.assertEqual([w["method"] for w in self.provider.requests], ["GET"])
        self.assertEqual(self.pipeline.show()["admitted_principal_usdc"], "1.000000")

    def test_fresh_preflight_is_required_when_retrying_an_unattempted_order(self):
        key = self.stage()["order_id"]
        self.provider.customer["status"] = "paused"
        self.run_one(key)
        self.provider.customer["status"] = "active"
        self.assertEqual(self.run_one(key)["phase"], "PROVIDER_OBSERVED")
        self.assertEqual([w["method"] for w in self.provider.requests], ["GET", "GET", "POST"])

    def test_provider_observation_never_credits_synthetic_spending_or_releases_admission(self):
        key = self.stage()["order_id"]
        self.run_one(key)
        original = next(iter(self.provider.effects.values()))
        original["state"] = "payment_processed"
        self.run_one(key)
        status = self.pipeline.show()
        self.assertFalse(status["automatic_exposure_release"])
        self.assertEqual(status["remaining_admission_usdc"], "3.000000")
        book = self.api.request("GET", self.route, token=self.agent)[1]
        self.assertEqual(book["state"]["accounting"]["gross_settled_principal"], 0)

    def test_lost_create_reply_is_discovered_read_only_and_never_posted_again(self):
        key = self.stage()["order_id"]
        self.provider.mode = "drop"
        self.assertEqual(self.run_one(key)["phase"], "PROVIDER_UNKNOWN")
        self.provider.mode = "ok"
        recovered = self.run_one(key)
        self.assertEqual(recovered["phase"], "RECONCILIATION_REQUIRED")
        self.assertEqual(len(recovered["candidate_ids"]), 1)
        explicit = self.pipeline.run_one(key, None, None, self.client, recovery_only=True, transfer_id=recovered["candidate_ids"][0])
        self.assertEqual(explicit["phase"], "PROVIDER_OBSERVED")
        self.assertEqual([w["method"] for w in self.provider.requests], ["GET", "POST", "GET", "GET"])
        self.assertEqual(len(self.provider.effects), 1)

    def test_empty_discovery_preserves_exposure_and_never_reopens_creation(self):
        key = self.stage()["order_id"]
        self.provider.mode = "drop"
        self.run_one(key)
        self.provider.mode = "ok"
        self.provider.listing = []
        result = self.run_one(key)
        self.assertEqual(result["code"], "NO_MATCH_IN_SCAN")
        self.assertEqual(result["phase"], "RECONCILIATION_REQUIRED")
        self.assertEqual(sum(w["method"] == "POST" for w in self.provider.requests), 1)

    def test_bridge_atomic_create_once_rejects_a_second_attempt_even_inside_retry_window(self):
        key = self.stage()["order_id"]
        self.provider.mode = "drop"
        self.run_one(key)
        before = len(self.provider.requests)
        self.error("BRIDGE_CREATE_ALREADY_ATTEMPTED", lambda: self.pipeline.bridge.create_once(key, self.client))
        self.assertEqual(len(self.provider.requests), before)

    def test_pipeline_revocation_blocks_unfenced_dispatch_and_new_admissions(self):
        key = self.stage()["order_id"]
        second = self.purchase(2)
        self.pipeline.revoke(self.api, self.operator)
        self.assertEqual(self.run_one(key)["code"], "PIPELINE_MANDATE_REVOKED")
        self.error("PIPELINE_MANDATE_REVOKED", lambda: self.stage(second))
        self.assertEqual(self.provider.requests, [])

    def test_revocation_during_preflight_is_rechecked_at_dispatch_fence(self):
        key = self.stage()["order_id"]
        original = self.client.preflight

        def revoke_after_read(customer_id):
            result = original(customer_id)
            self.pipeline.revoke(self.api, self.operator)
            return result

        with patch.object(self.client, "preflight", revoke_after_read):
            self.assertEqual(self.run_one(key)["code"], "PIPELINE_MANDATE_REVOKED")
        self.assertEqual([w["method"] for w in self.provider.requests], ["GET"])
        self.assertEqual(self.pipeline.bridge.show(key)["attempts"], 0)

    def test_commerce_revocation_is_checked_before_provider_creation(self):
        key = self.stage()["order_id"]
        self.api.request("POST", self.route + "/actions", {"request_id": "d" * 32, "command": {"kind": "REVOKE"}}, self.operator)
        self.assertEqual(self.run_one(key)["code"], "PIPELINE_COMMERCE_REVOKED")
        self.assertEqual([w["method"] for w in self.provider.requests], ["GET"])

    def test_commerce_expiry_blocks_a_prepared_order_without_release(self):
        key = self.stage()["order_id"]
        self.f.at += 800_001
        self.assertEqual(self.run_one(key)["code"], "PIPELINE_COMMERCE_EXPIRED")
        self.assertEqual(self.pipeline.show()["admitted_principal_usdc"], "1.000000")
        self.assertEqual(len(self.provider.effects), 0)

    def test_manual_prior_submit_cannot_be_taken_over_as_the_gateway_submit(self):
        key = self.stage()["order_id"]
        terms = self.pipeline.show()["orders"][0]["terms"]
        self.api.request("POST", self.route + "/actions", {"request_id": "d" * 32,
            "command": {"kind": "SUBMIT", "purchase_id": terms["envelope"]["purchase_id"],
                "binding_sha256": terms["envelope"]["commerce_binding_sha256"]}}, self.agent)
        self.assertEqual(self.run_one(key)["code"], "PIPELINE_COMMERCE_SUBMISSION_REFUSED")
        self.assertEqual(len(self.provider.effects), 0)

    def test_dispatch_fenced_before_revocation_can_complete_but_only_get_afterward(self):
        key = self.stage()["order_id"]
        original = self.client.create

        def revoke_after_claim(body, idempotency_key):
            self.pipeline.revoke(self.api, self.operator)
            return original(body, idempotency_key)

        with patch.object(self.client, "create", revoke_after_claim):
            self.assertEqual(self.run_one(key)["phase"], "PROVIDER_OBSERVED")
        self.assertEqual(self.run_one(key)["phase"], "PROVIDER_OBSERVED")
        self.assertEqual([w["method"] for w in self.provider.requests], ["GET", "POST", "GET"])

    def test_read_only_recovery_still_works_after_pipeline_revocation(self):
        key = self.stage()["order_id"]
        self.run_one(key)
        self.pipeline.revoke(self.api, self.operator)
        self.assertEqual(self.pipeline.run_one(key, None, None, self.client, recovery_only=True)["phase"], "PROVIDER_OBSERVED")
        self.assertEqual(self.provider.requests[-1]["method"], "GET")

    def test_read_only_recovery_refuses_an_unattempted_order(self):
        key = self.stage()["order_id"]
        value = self.pipeline.run_one(key, None, None, self.client, recovery_only=True)
        self.assertEqual(value["code"], "PIPELINE_RECOVERY_REQUIRES_ATTEMPT")
        self.assertEqual(self.provider.requests, [])

    def test_two_workers_cannot_overlap_the_same_order(self):
        key = self.stage()["order_id"]
        self.provider.mode = "block_reads"
        with ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(self.run_one, key)
            self.assertTrue(self.provider.entered.wait(3))
            self.error("PIPELINE_ORDER_BUSY", lambda: self.run_one(key))
            self.provider.release.set()
            self.assertEqual(first.result()["phase"], "PROVIDER_OBSERVED")
        self.assertEqual(len(self.provider.effects), 1)

    def test_batch_advances_multiple_orders_and_filters_other_agents(self):
        for i in (1, 2, 3):
            self.stage(self.purchase(i))
        self.stage(self.purchase(4, token=self.second), self.second)
        result = self.pipeline.run_batch(lambda: LocalAPI(self.f), self.agent, self.client, limit=8, workers=3)
        self.assertEqual(result["orders_selected"], 3)
        self.assertTrue(all(o["phase"] == "PROVIDER_OBSERVED" for o in result["outcomes"]), result["outcomes"])
        self.assertEqual(len(self.provider.effects), 3)
        self.assertEqual(sum(o["phase"] == "QUEUED" for o in self.pipeline.show()["orders"]), 1)

    def test_small_batch_does_not_starve_later_unprocessed_orders(self):
        keys = {self.stage(self.purchase(i))["order_id"] for i in (1, 2, 3, 4)}
        first = self.pipeline.run_batch(lambda: LocalAPI(self.f), self.agent, self.client, limit=2, workers=2)
        second = self.pipeline.run_batch(lambda: LocalAPI(self.f), self.agent, self.client, limit=2, workers=2)
        first_ids = {o["order_id"] for o in first["outcomes"]}
        second_ids = {o["order_id"] for o in second["outcomes"]}
        self.assertFalse(first_ids & second_ids)
        self.assertEqual(first_ids | second_ids, keys)
        self.assertEqual(len(self.provider.effects), 4)

    def test_batch_failure_is_isolated_and_other_orders_continue(self):
        keys = [self.stage(self.purchase(i))["order_id"] for i in (1, 2)]
        original = self.client.preflight
        counter = iter((False, True))
        lock = threading.Lock()

        def fail_one(customer_id):
            with lock:
                fail = next(counter)
            if fail:
                raise OSError("PRIVATE FAILURE " + KEY)
            return original(customer_id)

        with patch.object(self.client, "preflight", fail_one):
            result = self.pipeline.run_batch(lambda: LocalAPI(self.f), self.agent, self.client)
        self.assertEqual({o["order_id"] for o in result["outcomes"]}, set(keys))
        self.assertEqual(sorted(o["phase"] for o in result["outcomes"]), ["BLOCKED", "PROVIDER_OBSERVED"])
        self.assertNotIn(KEY, canonical(result))
        self.assertEqual(len(self.provider.effects), 1)

    def test_stale_claim_cannot_complete_or_dispatch_after_lease_recovery(self):
        key = self.stage()["order_id"]
        claim, _terms, _mandate = self.pipeline._claim(key)
        self.f.at += LEASE_MS + 1
        newer, _terms, _mandate = self.pipeline._claim(key)
        self.error("PIPELINE_STALE_CLAIM", lambda: self.pipeline._fence(key, claim))
        from zoora_community.payment_pipeline import result
        self.error("PIPELINE_STALE_CLAIM", lambda: self.pipeline._finish(key, claim, result("BLOCKED", "TEST")))
        self.assertNotEqual(claim, newer)

    def test_source_instance_change_stops_new_dispatch_but_does_not_invent_settlement(self):
        key = self.stage()["order_id"]
        with closing(sqlite3.connect(self.f.store.path, autocommit=True)) as connection:
            connection.execute("UPDATE metadata SET value=? WHERE key='instance_id'", ("f" * 32,))
        self.error("PIPELINE_SOURCE_INSTANCE_CHANGED", lambda: self.run_one(key))
        self.assertEqual(self.provider.requests, [])

    def test_credential_rotation_does_not_rebind_existing_provider_attempt(self):
        key = self.stage()["order_id"]
        self.run_one(key)
        changed = BridgeSandboxClient(KEY + "X")
        before = len(self.provider.requests)
        value = self.pipeline.run_one(key, self.api, self.agent, changed)
        self.assertEqual(value["code"], "BRIDGE_CREDENTIAL_CHANGED_RECONCILE_REQUIRED")
        self.assertEqual(len(self.provider.requests), before)

    def test_provider_journal_restore_cannot_reenable_creation_through_pipeline(self):
        key = self.stage()["order_id"]
        self.pipeline.bridge.prepare(self.pipeline.show()["orders"][0]["terms"]["intent"])
        snapshot = self.folder / "snapshot.sqlite3"
        saved = self.pipeline.bridge.backup(snapshot)
        from zoora_community.bridge_journal import BridgeJournal
        restored = BridgeJournal(self.folder / "restored", clock=lambda: self.f.at)
        restored.restore(snapshot, saved["backup_sha256"])
        self.pipeline.bridge = restored
        self.assertEqual(self.run_one(key)["code"], "BRIDGE_RESTORED_JOURNAL_READ_ONLY")
        self.assertEqual(len(self.provider.effects), 0)

    def test_audit_rejects_changed_terms_mandate_and_extra_schema_objects(self):
        self.stage()
        with closing(sqlite3.connect(self.pipeline.path, autocommit=True)) as connection:
            original = connection.execute("SELECT mandate_json FROM control").fetchone()[0]
            changed = json.loads(original)
            changed["admission_budget_usdc"] = "5.000000"
            connection.execute("UPDATE control SET mandate_json=?", (canonical(changed),))
        self.error("PIPELINE_CONSISTENCY_FAILURE", self.pipeline.audit)
        with closing(sqlite3.connect(self.pipeline.path, autocommit=True)) as connection:
            connection.execute("UPDATE control SET mandate_json=?", (original,))
            connection.execute("CREATE VIEW unreviewed AS SELECT * FROM control")
        self.error("PIPELINE_CONSISTENCY_FAILURE", self.pipeline.audit)

    def test_clock_regression_is_refused_before_new_claim_or_http(self):
        key = self.stage()["order_id"]
        self.f.at -= 1
        self.error("PIPELINE_CLOCK_REGRESSION", lambda: self.pipeline._claim(key))
        self.assertEqual(self.provider.requests, [])

    def test_api_keys_never_appear_in_queue_or_combined_status(self):
        key = self.stage()["order_id"]
        self.run_one(key)
        self.assertNotIn(KEY.encode(), self.pipeline.path.read_bytes())
        for token in (KEY, self.agent, self.operator):
            self.assertNotIn(token, canonical(self.pipeline.show()))

    def test_server_retains_exact_pipeline_terms_and_source_in_authenticated_submit(self):
        key = self.stage()["order_id"]
        self.run_one(key)
        terms_hash = self.pipeline.show()["orders"][0]["terms_sha256"]
        with closing(sqlite3.connect(self.f.store.path)) as connection:
            rows = connection.execute("SELECT request_json,actor_id FROM commerce_actions WHERE outcome='SIMULATED_SUBMISSION'").fetchall()
        self.assertEqual(len(rows), 1)
        body = json.loads(rows[0][0])
        self.assertEqual(body["sandbox_dispatch"], {"instance_id": self.mandate["instance_id"], "pipeline_terms_sha256": terms_hash})
        self.assertEqual(rows[0][1], self.agent_id)
        self.f.store.audit()

    def test_instance_change_during_preflight_is_refused_inside_atomic_commerce_submit(self):
        key = self.stage()["order_id"]
        original = self.client.preflight

        def change_source(customer_id):
            value = original(customer_id)
            with closing(sqlite3.connect(self.f.store.path, autocommit=True)) as connection:
                connection.execute("UPDATE metadata SET value=? WHERE key='instance_id'", ("f" * 32,))
            return value

        with patch.object(self.client, "preflight", change_source):
            self.assertEqual(self.run_one(key)["code"], "COMMERCE_SANDBOX_INSTANCE_MISMATCH")
        self.assertEqual([w["method"] for w in self.provider.requests], ["GET"])

    def test_dispatch_context_cannot_be_added_to_other_commands_or_hide_extra_fields(self):
        before = self.f.store.audit()
        for command, context, expected in (({"kind": "REVOKE"}, {"instance_id": self.mandate["instance_id"], "pipeline_terms_sha256": "a" * 64}, "COMMERCE_SANDBOX_CONTEXT_REQUIRES_SUBMIT"),
                ({"kind": "SUBMIT", "purchase_id": "a" * 32, "binding_sha256": "b" * 64}, {"api_key": KEY}, "INVALID_FIELDS")):
            self.error(expected, lambda command=command, context=context: self.api.request("POST", self.route + "/actions",
                {"request_id": "f" * 32, "command": command, "sandbox_dispatch": context}, self.operator))
        self.assertEqual(self.f.store.audit(), before)

    def test_crash_after_own_commerce_submit_replays_it_and_preserves_one_create(self):
        key = self.stage()["order_id"]
        with patch.object(self.pipeline.bridge, "create_once", side_effect=SystemExit(82)):
            with self.assertRaises(SystemExit):
                self.run_one(key)
        self.assertEqual(self.pipeline.audit()["unfinished_claims"], 1)
        self.assertEqual(self.pipeline.bridge.show(key)["attempts"], 0)
        self.f.at += LEASE_MS + 1
        self.assertEqual(self.run_one(key)["phase"], "PROVIDER_OBSERVED")
        book = self.api.request("GET", self.route, token=self.agent)[1]
        self.assertEqual(book["revision"], 2)
        self.assertEqual(sum(w["method"] == "POST" for w in self.provider.requests), 1)

    def test_crash_after_provider_acceptance_uses_discovery_and_explicit_get_recovery(self):
        key = self.stage()["order_id"]
        original = self.client.create

        def crash(body, idempotency_key):
            original(body, idempotency_key)
            raise SystemExit(83)

        with patch.object(self.client, "create", crash):
            with self.assertRaises(SystemExit):
                self.run_one(key)
        self.f.at += LEASE_MS + 1
        observed = self.run_one(key)
        self.assertEqual(observed["phase"], "RECONCILIATION_REQUIRED")
        self.assertEqual(self.pipeline.run_one(key, None, None, self.client, recovery_only=True,
            transfer_id=observed["candidate_ids"][0])["phase"], "PROVIDER_OBSERVED")
        self.assertEqual(sum(w["method"] == "POST" for w in self.provider.requests), 1)

    def test_crash_at_dispatch_fence_preserves_provider_key_and_does_not_double_reserve(self):
        key = self.stage()["order_id"]
        original = self.pipeline._fence

        def crash(order, claim):
            original(order, claim)
            raise SystemExit(84)

        with patch.object(self.pipeline, "_fence", crash):
            with self.assertRaises(SystemExit):
                self.run_one(key)
        before = self.pipeline.bridge.show(key)
        self.assertEqual(before["attempts"], 0)
        self.f.at += LEASE_MS + 1
        self.assertEqual(self.run_one(key)["phase"], "PROVIDER_OBSERVED")
        self.assertEqual(self.pipeline.bridge.show(key)["idempotency_key"], before["idempotency_key"])
        self.assertEqual(self.pipeline.show()["admitted_principal_usdc"], "1.000000")
        self.assertEqual(self.pipeline.audit()["dispatch_fences"], 2)


class PaymentContractTests(unittest.TestCase):
    def test_mandate_rejects_production_secret_fields_trading_and_invalid_denominations(self):
        base = {"mandate_id": "b" * 32, "environment": "BRIDGE_SANDBOX", "real_funds_authorized": False,
            "instance_id": "c" * 32, "operator_id": "d" * 32, "agents": ["e" * 32],
            "customer_id": intent()["customer_id"], "source_address": intent()["source_address"],
            "merchants": [{"merchant": "supplier", "destination_address": intent()["destination_address"], "activities": ["api_service"]}],
            "payment_limit_usdc": "2", "admission_budget_usdc": "4", "valid_from_ms": 1, "expires_ms": 2}
        for change in ({"environment": "PRODUCTION"}, {"real_funds_authorized": True}, {"api_key": KEY},
                {"payment_limit_usdc": 1.5}, {"payment_limit_usdc": "5"}, {"expires_ms": True}):
            with self.assertRaises(Problem):
                mandate_value({**base, **change})
        bad = copy.deepcopy(base)
        bad["merchants"][0]["activities"] = ["crypto_trade"]
        with self.assertRaises(Problem):
            mandate_value(bad)

    def test_purchase_identity_does_not_change_when_amount_or_mandate_id_changes(self):
        source = {"instance_id": "c" * 32, "mandate_id": "d" * 32}
        envelope = {"book_id": "e" * 32, "purchase_id": "f" * 32, "amount_usdc": "1"}
        self.assertEqual(order_id(source, envelope), order_id({**source, "mandate_id": "a" * 32}, {**envelope, "amount_usdc": "2"}))


if __name__ == "__main__":
    unittest.main()
