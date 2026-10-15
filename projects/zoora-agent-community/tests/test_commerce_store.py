"""Real API authority, transactional durable replay and recovery boundaries."""

from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
import copy
import hashlib
import json
import sqlite3
import subprocess
import sys
import unittest
from unittest.mock import patch
import uuid

from helpers import Fixture
from test_commerce import policy, request
from zoora_community.commerce import fingerprint
from zoora_community.recovery import restore_backup, verify_backup
from zoora_community.store import AUDIT_DOMAIN, SCHEMA_VERSION, Store, ZERO_HASH
from zoora_community.validation import Problem, canonical

ROOT_ROUTE = "/v1/commerce/books"


def fixture_policy():
    p = policy()
    p["authority"]["operator"] = "operator"
    p["authority"]["expires"] = 100_000
    for route in p["routes"]:
        route.update(account_owner="operator", eligible_until=100_000)
    p["subscriptions"] = []
    return p


def purchase_command(index=1, **changes):
    value = request(index, quote={"expires": 90_000, **changes})
    del value["quote"]["payer"]
    return {"kind": "PURCHASE", "request": value}


class DurableCommerceTests(unittest.TestCase):
    def setUp(self):
        self.f = Fixture()
        self.addCleanup(self.f.close)
        self.operator_id, self.operator = self.f.operator()
        self.agent_id, self.agent = self.f.agent(self.operator)
        self.alias_id, self.alias = self.f.agent(self.operator, "agent_two")
        self.body = {"request_id": "a" * 32, "policy": fixture_policy(),
                     "bindings": [{"alias": "agent_one", "agent_id": self.agent_id},
                                  {"alias": "agent_two", "agent_id": self.alias_id}]}
        self.book = self.create()[1]["book"]
        self.route = ROOT_ROUTE + "/" + self.book["id"]

    def create(self, body=None, token=None):
        return self.f.store.call("POST", ROOT_ROUTE, body or self.body, token or self.operator)

    def view(self, token=None):
        return self.f.store.call("GET", self.route, token=token or self.agent)[1]

    def post(self, command, token=None, request_id=None):
        return self.f.store.call("POST", self.route + "/actions",
                                 {"request_id": request_id or uuid.uuid4().hex, "command": command}, token or self.agent)[1]

    def command(self, kind, index=0, **changes):
        record = self.view()["state"]["purchases"][index]
        return {"kind": kind, "purchase_id": record["request"]["quote"]["purchase_id"],
                "binding_sha256": record["binding_sha256"], **changes}

    def error(self, code, callback):
        with self.assertRaises(Problem) as caught:
            callback()
        self.assertEqual(caught.exception.code, code)

    def test_creation_is_operator_only_and_binds_only_its_own_registered_agents(self):
        for token in (self.agent, self.alias, self.f.owner):
            self.error("FORBIDDEN", lambda token=token: self.create(token=token))
        _, other_operator = self.f.operator("another_operator")
        other_id, _ = self.f.agent(other_operator, "another_agent")
        bad = copy.deepcopy(self.body)
        bad["request_id"] = "b" * 32
        bad["bindings"][0]["agent_id"] = other_id
        self.error("COMMERCE_FOREIGN_AGENT", lambda: self.create(bad))
        self.f.store.audit()

    def test_private_reads_and_listing_exclude_unrelated_operators_and_agents(self):
        _, stranger = self.f.operator("stranger_operator")
        _, stranger_agent = self.f.agent(stranger, "stranger_agent")
        self.error("UNAUTHORIZED", lambda: self.f.store.call("GET", self.route))
        for token in (stranger, stranger_agent):
            self.error("FORBIDDEN", lambda token=token: self.view(token))
            self.assertEqual(self.f.store.call("GET", ROOT_ROUTE, token=token)[1]["items"], [])
        for token in (self.agent, self.alias, self.operator, self.f.owner):
            self.assertEqual(self.view(token)["operator_id"], self.operator_id)

    def test_actor_payer_and_clock_cannot_be_supplied_by_the_client(self):
        for key, value in [("actor", "agent_two"), ("at_tick", 0)]:
            self.error("SERVER_COMMERCE_IDENTITY_REQUIRED", lambda key=key, value=value: self.post({**purchase_command(), key: value}))
        bad = purchase_command()
        bad["request"]["quote"]["payer"] = "agent_two"
        self.error("SERVER_COMMERCE_IDENTITY_REQUIRED", lambda: self.post(bad))
        accepted = self.post(purchase_command(), self.alias)
        record = accepted["book"]["state"]["purchases"][0]
        self.assertEqual(record["request"]["quote"]["payer"], "agent_two")
        self.assertEqual(accepted["outcome"], "AUTHORIZED")

    def test_invalid_extra_secret_fields_do_not_write_any_record(self):
        before = self.f.store.path.read_bytes()
        self.error("INVALID_FIELDS", lambda: self.post({**purchase_command(), "private_key": "never ingest"}))
        self.error("INVALID_FIELDS", lambda: self.f.store.call("POST", self.route + "/actions",
                   {"request_id": "b" * 32, "command": purchase_command(), "at_ms": 0}, self.agent))
        self.assertEqual(before, self.f.store.path.read_bytes())

    def test_malformed_operator_cancellation_and_corrupt_bindings_fail_safely(self):
        self.error("INVALID_ID", lambda: self.post({"kind": "CANCEL", "purchase_id": [], "binding_sha256": "a" * 64}, self.operator))
        with closing(sqlite3.connect(self.f.store.path, autocommit=True)) as connection:
            connection.execute("UPDATE commerce_books SET bindings_json='null'")
        self.error("COMMERCE_CONSISTENCY_FAILURE", self.view)
        self.error("COMMERCE_CONSISTENCY_FAILURE", lambda: self.f.store.call("GET", ROOT_ROUTE, token=self.operator))

    def test_exact_create_and_command_retries_do_not_write_again(self):
        before = self.f.store.path.read_bytes()
        self.assertTrue(self.create()[1]["replayed"])
        self.assertEqual(before, self.f.store.path.read_bytes())
        first = self.post(purchase_command(), request_id="b" * 32)
        self.f.at += 3
        before = self.f.store.path.read_bytes()
        second = self.post(purchase_command(), request_id="b" * 32)
        self.assertTrue(second["replayed"])
        self.assertEqual(second["book"]["revision"], first["book"]["revision"])
        self.assertEqual(before, self.f.store.path.read_bytes())
        self.f.store.audit()

    def test_retry_conflicts_for_changed_request_or_another_agent(self):
        self.post(purchase_command(), request_id="b" * 32)
        self.error("COMMERCE_REQUEST_CONFLICT", lambda: self.post(purchase_command(amount=61), request_id="b" * 32))
        self.error("COMMERCE_REQUEST_CONFLICT", lambda: self.post(purchase_command(), self.alias, "b" * 32))
        changed = copy.deepcopy(self.body)
        changed["policy"]["authority"]["payment_budget"] += 1
        self.error("COMMERCE_REQUEST_CONFLICT", lambda: self.create(changed))

    def test_real_registered_agents_share_one_budget_across_database_connections(self):
        def attempt(index):
            store = Store(self.f.state, clock=lambda: self.f.at)
            command = purchase_command(index + 1)
            result = store.call("POST", self.route + "/actions", {"request_id": uuid.uuid4().hex, "command": command},
                                self.agent if index % 2 else self.alias)[1]
            return result["outcome"]
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(attempt, range(8)))
        self.assertEqual(results.count("AUTHORIZED"), 2)
        self.assertEqual(results.count("PAYMENT_BUDGET"), 6)
        self.assertEqual(self.view()["state"]["authority"]["totals"]["payment_reserved"], 120)
        self.f.store.audit()

    def test_two_actual_processes_cannot_double_reserve_budget(self):
        # The credential is sent over stdin, never in argv or process output.
        code = """import json,sys
from zoora_community.store import Store
x=json.load(sys.stdin)
r=Store(x['state'],clock=lambda:x['at']).call('POST',x['route'],x['body'],x['token'])[1]
print(r['outcome'])
"""
        self.post(purchase_command(amount=100))
        children = []
        try:
            for i in (2, 3):
                child = subprocess.Popen([sys.executable, "-c", code], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                value = {"state": str(self.f.state), "at": self.f.at, "route": self.route + "/actions",
                         "body": {"request_id": uuid.uuid4().hex, "command": purchase_command(i, amount=40)}, "token": self.alias}
                child.stdin.write(canonical(value))
                child.stdin.close()
                child.stdin = None
                children.append(child)
            outputs = [child.communicate(timeout=15) for child in children]
            self.assertTrue(all(child.returncode == 0 for child in children), outputs)
            self.assertEqual(sorted(out.strip() for out, _ in outputs), ["AUTHORIZED", "PAYMENT_BUDGET"])
        finally:
            for child in children:
                if child.poll() is None:
                    child.kill()
                    child.communicate(timeout=5)
        self.f.store.audit()

    def test_agent_cannot_use_another_agents_purchase(self):
        self.post(purchase_command())
        self.assertEqual(self.post(self.command("SUBMIT"), self.alias)["outcome"], "ACTOR_MISMATCH")
        self.assertEqual(self.post(self.command("SUBMIT"))["outcome"], "SIMULATED_SUBMISSION")

    def test_operator_cannot_impersonate_an_agent_or_accept_an_unmarked_fixture(self):
        self.error("FORBIDDEN", lambda: self.post(purchase_command(), self.operator))
        self.post(purchase_command())
        self.error("FORBIDDEN", lambda: self.post(self.command("SUBMIT"), self.operator))
        self.post(self.command("SUBMIT"))
        resolve = self.command("RESOLVE", receipt_id="f" * 32, outcome="SETTLED", actual_fee=2)
        self.error("FORBIDDEN", lambda: self.post({**resolve, "fixture": True}))
        self.error("SYNTHETIC_FIXTURE_REQUIRED", lambda: self.post(resolve, self.operator))
        self.assertEqual(self.post({**resolve, "fixture": True}, self.operator)["outcome"], "SYNTHETIC_SETTLED")
        self.f.store.audit()

    def test_platform_owner_can_pause_but_cannot_create_or_supply_fixture_outcomes(self):
        self.post(purchase_command())
        self.error("FORBIDDEN", lambda: self.post(self.command("SUBMIT"), self.f.owner))
        self.assertEqual(self.post({"kind": "REVOKE"}, self.f.owner)["outcome"], "REVOKED")
        self.assertEqual(self.post(purchase_command(2))["outcome"], "AUTHORITY_REVOKED")
        self.f.store.audit()

    def test_operator_can_cancel_unsent_purchase_without_agent_impersonation_input(self):
        self.post(purchase_command())
        self.assertEqual(self.post(self.command("CANCEL"), self.operator)["outcome"], "CANCELLED")
        self.assertEqual(self.view()["state"]["authority"]["totals"]["payment_reserved"], 0)
        self.f.store.audit()

    def test_restart_preserves_one_attempt_and_uncertain_reservations(self):
        self.post(purchase_command())
        first = self.post(self.command("SUBMIT"), request_id="c" * 32)
        attempt = first["book"]["state"]["authority"]["payments"][0]["attempt_id"]
        self.f.store = Store(self.f.state, clock=lambda: self.f.at)
        retry = self.post(self.command("SUBMIT"), request_id="c" * 32)
        self.assertTrue(retry["replayed"])
        self.assertEqual(retry["book"]["state"]["authority"]["payments"][0]["attempt_id"], attempt)
        self.post(self.command("RESOLVE", fixture=True, outcome="UNKNOWN", receipt_id=None, actual_fee=None), self.operator)
        self.post({"kind": "REVOKE"}, self.operator)
        self.f.at += 100_001
        self.f.store = Store(self.f.state, clock=lambda: self.f.at)
        self.assertEqual(self.view()["state"]["authority"]["totals"]["payment_reserved"], 60)
        self.assertEqual(self.post(self.command("SUBMIT"))["outcome"], "SAME_ATTEMPT")
        result = self.post(self.command("RESOLVE", fixture=True, receipt_id="f" * 32, outcome="SETTLED", actual_fee=2), self.operator)
        self.assertEqual(result["book"]["state"]["authority"]["totals"]["payment_spent"], 60)
        self.f.store.audit()

    def test_server_time_revalidates_expired_authorization_and_cannot_go_backwards(self):
        self.post(purchase_command(expires=1))
        self.f.at += 1
        result = self.post(self.command("SUBMIT"))
        self.assertEqual(result["outcome"], "NOT_AUTHORIZED")
        self.assertEqual(result["book"]["state"]["authority"]["totals"]["payment_reserved"], 0)
        self.f.at -= 1
        self.error("CLOCK_REGRESSION", self.view)

    def test_failed_append_rolls_back_both_book_and_audit_atomically(self):
        before = self.f.store.path.read_bytes()
        with patch.object(Store, "_event", side_effect=RuntimeError("injected append failure")):
            with self.assertRaises(RuntimeError):
                self.post(purchase_command())
        self.assertEqual(before, self.f.store.path.read_bytes())
        self.assertEqual(self.view()["revision"], 0)
        self.f.store.audit()

    def test_abrupt_process_exit_before_commit_recovers_without_a_partial_purchase(self):
        code = """import json,os,sys
from unittest.mock import patch
from zoora_community.store import Store
x=json.load(sys.stdin)
with patch.object(Store,'_event',side_effect=lambda *a,**k:os._exit(73)):
 Store(x['state'],clock=lambda:x['at']).call('POST',x['route'],x['body'],x['token'])
"""
        value = {"state": str(self.f.state), "at": self.f.at, "route": self.route + "/actions",
                 "body": {"request_id": "b" * 32, "command": purchase_command()}, "token": self.agent}
        child = subprocess.run([sys.executable, "-c", code], input=canonical(value), capture_output=True, text=True, timeout=15)
        self.assertEqual(child.returncode, 73, child.stderr)
        self.f.store = Store(self.f.state, clock=lambda: self.f.at)
        self.assertEqual(self.view()["revision"], 0)
        self.f.store.audit()
        self.assertEqual(self.post(purchase_command(), request_id="b" * 32)["outcome"], "AUTHORIZED")

    def test_create_retry_reconciles_without_reactivating_a_suspended_binding(self):
        self.f.store.call("PATCH", "/v1/agents/" + self.agent_id, {"active": False}, self.operator)
        before = self.f.store.path.read_bytes()
        self.assertTrue(self.create()[1]["replayed"])
        self.assertEqual(before, self.f.store.path.read_bytes())
        self.error("COMMERCE_AGENT_INACTIVE", lambda: self.create({**self.body, "request_id": "b" * 32}))

    def test_credentials_rotate_without_resetting_budget_or_retry_identity(self):
        self.post(purchase_command(), request_id="b" * 32)
        fresh = self.f.store.call("POST", "/v1/agents/" + self.agent_id + "/credentials", {}, self.operator)[1]["credential"]["token"]
        self.error("UNAUTHORIZED", self.view)
        self.agent = fresh
        self.assertTrue(self.post(purchase_command(), request_id="b" * 32)["replayed"])
        self.assertEqual(self.view()["state"]["authority"]["totals"]["payment_reserved"], 60)
        self.f.store.audit()

    def test_suspension_rejects_fresh_actions_and_retains_unresolved_state(self):
        self.post(purchase_command())
        self.post(self.command("SUBMIT"))
        self.f.store.call("PATCH", "/v1/agents/" + self.agent_id, {"active": False}, self.operator)
        self.error("UNAUTHORIZED", self.view)
        self.assertEqual(self.view(self.operator)["state"]["authority"]["totals"]["payment_reserved"], 60)
        self.f.store.audit()

    def test_partial_refunds_and_fulfillment_evidence_survive_backup_restore(self):
        command = purchase_command()
        command["request"].update(activity="white_label_supply")
        self.post(command)
        self.post(self.command("SUBMIT"))
        self.post(self.command("RESOLVE", fixture=True, receipt_id="f" * 32, outcome="SETTLED", actual_fee=2), self.operator)
        self.post(self.command("FULFILL", fixture=True, order_id="d" * 32), self.operator)
        self.post(self.command("REFUND", fixture=True, receipt_id="e" * 32, amount=10), self.operator)
        state = self.view()["state"]
        backup = self.f.root / "snapshot.sqlite3"
        self.f.store.backup(backup)
        self.assertEqual(verify_backup(backup)["audit"], self.f.store.audit())
        restored = self.f.root / "restored"
        restore_backup(backup, restored)
        self.f.store = Store(restored, clock=lambda: self.f.at)
        self.assertEqual(self.view()["state"], state)
        self.assertEqual(state["accounting"]["net_settled_principal"], 50)
        self.f.store.audit()

    def test_recovery_invalidates_credentials_without_erasing_book_history(self):
        self.post(purchase_command())
        old_hash = self.view()["state_sha256"]
        owner_file = self.f.root / "recovered.json"
        self.f.store.recover_owner(owner_file, invalidate_all=True)
        self.error("UNAUTHORIZED", self.view)
        owner = json.loads(owner_file.read_text())["token"]
        self.assertEqual(self.view(owner)["state_sha256"], old_hash)
        self.f.store.audit()

    def test_policy_action_outcome_and_state_tampering_fail_replay_audit(self):
        self.post(purchase_command())
        with closing(sqlite3.connect(self.f.store.path, autocommit=True)) as connection:
            connection.execute("UPDATE commerce_actions SET outcome='SYNTHETIC_SETTLED'")
        self.error("COMMERCE_CONSISTENCY_FAILURE", self.f.store.audit)
        self.error("COMMERCE_CONSISTENCY_FAILURE", self.view)
        backup = self.f.root / "rejected.sqlite3"
        self.error("COMMERCE_CONSISTENCY_FAILURE", lambda: self.f.store.backup(backup))
        self.assertFalse(backup.exists())

    def test_deleted_actions_are_detected_even_when_book_summary_is_rehashed(self):
        self.post(purchase_command())
        with closing(sqlite3.connect(self.f.store.path, autocommit=True)) as connection:
            connection.execute("DELETE FROM commerce_actions")
            from zoora_community.commerce import CommerceBook
            initial = CommerceBook(fixture_policy())
            connection.execute("UPDATE commerce_books SET revision=0,state_sha256=?,updated_ms=created_ms", (fingerprint(initial.snapshot()),))
        self.error("COMMERCE_CONSISTENCY_FAILURE", self.f.store.audit)

    def test_rehashed_audit_cannot_attribute_an_action_to_another_operator(self):
        self.post(purchase_command())
        _, other = self.f.operator("another_operator")
        with closing(self.f.store._connection()) as connection:
            principal = self.f.store._authenticate(connection, other, self.f.at)
            row = connection.execute("SELECT * FROM commerce_actions").fetchone()
            connection.execute("UPDATE commerce_actions SET actor_role='OPERATOR',actor_id=?,credential_id=?", (principal["principal_id"], principal["id"]))
            previous = ZERO_HASH
            for event in connection.execute("SELECT * FROM audit ORDER BY seq").fetchall():
                detail = json.loads(event["details"])
                role, actor = event["actor_role"], event["actor_id"]
                if event["resource_id"] == row["id"]:
                    role, actor = "OPERATOR", principal["principal_id"]
                    detail["credential_id"] = principal["id"]
                payload = [event["seq"], event["at_ms"], role, actor, event["action"], event["resource_id"], detail, previous]
                hashed = hashlib.sha256(AUDIT_DOMAIN + canonical(payload).encode()).hexdigest()
                connection.execute("UPDATE audit SET actor_role=?,actor_id=?,details=?,previous_hash=?,hash=? WHERE seq=?", (role, actor, canonical(detail), previous, hashed, event["seq"]))
                previous = hashed
        self.error("COMMERCE_CONSISTENCY_FAILURE", self.f.store.audit)

    def test_binding_duplicates_unbound_aliases_and_book_limits_are_refused(self):
        bad = copy.deepcopy(self.body)
        bad["bindings"][1]["agent_id"] = self.agent_id
        self.error("INVALID_COMMERCE_BINDINGS", lambda: self.create(bad))
        bad = copy.deepcopy(self.body)
        bad["policy"]["authority"]["agents"].append("unregistered_alias")
        self.error("INVALID_COMMERCE_BINDINGS", lambda: self.create(bad))
        for _ in range(3):
            self.create({**self.body, "request_id": uuid.uuid4().hex})
        self.error("COMMERCE_OPERATOR_BOOK_LIMIT", lambda: self.create({**self.body, "request_id": uuid.uuid4().hex}))

    def test_database_and_responses_do_not_contain_bearer_credentials(self):
        response = self.post(purchase_command())
        raw = self.f.store.path.read_bytes()
        for secret in (self.agent, self.alias, self.operator, self.f.owner):
            self.assertNotIn(secret.encode(), raw)
            self.assertNotIn(secret, canonical(response))
        self.assertFalse(response["book"]["wallet_execution"])
        self.assertTrue(response["book"]["durable_local_records"])
        self.assertFalse(response["book"]["live_execution_worker"])
        self.assertEqual(response["book"]["controller_authentication"], "LOCAL_API_CREDENTIAL")
        self.assertEqual(SCHEMA_VERSION, 6)
