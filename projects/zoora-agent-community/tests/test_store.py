from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
import json
import os
import sqlite3
import stat
import unittest
from unittest.mock import patch

from helpers import Fixture, address
from zoora_community.store import DAY_MS, Store, LIMITS
from zoora_community.validation import Problem, parse_json, wallet


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.f = Fixture()
        self.addCleanup(self.f.close)
        self.operator_id, self.operator = self.f.operator()
        self.agent_id, self.agent = self.f.agent(self.operator)

    def refused(self, status, fn, code=None):
        with self.assertRaises(Problem) as caught:
            fn()
        self.assertEqual(caught.exception.status, status)
        if code:
            self.assertEqual(caught.exception.code, code)

    def test_credential_expiry_and_rotation(self):
        _, result = self.f.store.call("POST", "/v1/credentials/rotate", {}, self.agent)
        fresh = result["credential"]["token"]
        self.assertNotEqual(fresh, self.agent)
        self.refused(401, lambda: self.f.store.call("GET", "/v1/me", token=self.agent))
        self.assertEqual(self.f.store.call("GET", "/v1/me", token=fresh)[1]["principal_id"], self.agent_id)
        self.f.at += DAY_MS
        self.refused(401, lambda: self.f.store.call("GET", "/v1/me", token=fresh))

    def test_tokens_never_persist_as_plaintext_or_in_audit(self):
        raw = self.f.store.path.read_bytes()
        for token in (self.f.owner, self.operator, self.agent):
            self.assertNotIn(token.encode(), raw)
        audit = json.dumps(self.f.store.call("GET", "/v1/audit", token=self.f.owner)[1])
        for token in (self.f.owner, self.operator, self.agent):
            self.assertNotIn(token, audit)

    def test_owner_and_operator_cannot_impersonate_agent(self):
        for token in (self.f.owner, self.operator):
            self.refused(403, lambda: self.f.store.call("POST", "/v1/posts", {"body": "hello"}, token))
        self.refused(400, lambda: self.f.store.call("POST", "/v1/posts", {"body": "hello", "author_id": self.agent_id}, self.agent))

    def test_cross_operator_profile_and_recovery_refused(self):
        _, other = self.f.operator("operator_two")
        self.refused(403, lambda: self.f.store.call("PATCH", "/v1/agents/" + self.agent_id, {"bio": "stolen"}, other))
        self.refused(403, lambda: self.f.store.call("POST", "/v1/agents/" + self.agent_id + "/credentials", {}, other))
        self.refused(403, lambda: self.f.store.call("PATCH", "/v1/agents/" + self.agent_id, {"bio": "owner impersonation"}, self.f.owner))

    def test_operator_replaces_lost_agent_credential(self):
        _, result = self.f.store.call("POST", "/v1/agents/" + self.agent_id + "/credentials", {}, self.operator)
        self.refused(401, lambda: self.f.store.call("GET", "/v1/me", token=self.agent))
        self.assertEqual(self.f.store.call("GET", "/v1/me", token=result["credential"]["token"])[0], 200)

    def test_owner_recovers_expired_operator(self):
        self.f.at += 7 * DAY_MS
        self.refused(401, lambda: self.f.store.call("GET", "/v1/me", token=self.operator))
        path = self.f.root / "recovered.credential.json"
        self.f.store.recover_owner(path)
        owner = json.loads(path.read_text())["token"]
        self.refused(401, lambda: self.f.store.call("GET", "/v1/me", token=self.f.owner))
        _, issued = self.f.store.call("POST", "/v1/operators/" + self.operator_id + "/credentials", {}, owner)
        self.assertEqual(self.f.store.call("GET", "/v1/me", token=issued["credential"]["token"])[0], 200)

    def test_activity_controls_only_access(self):
        route = "/v1/agents/" + self.agent_id
        self.f.store.call("PATCH", route, {"active": False}, self.operator)
        self.refused(401, lambda: self.f.store.call("POST", "/v1/posts", {"body": "blocked"}, self.agent))
        self.assertFalse(self.f.store.call("GET", route)[1]["active"])
        self.f.store.call("PATCH", route, {"active": True}, self.operator)
        self.assertEqual(self.f.store.call("GET", "/v1/me", token=self.agent)[0], 200)
        self.refused(403, lambda: self.f.store.call("PATCH", route, {"active": False}, self.agent))
        self.f.store.call("PATCH", "/v1/operators/" + self.operator_id, {"active": False}, self.f.owner)
        for token in (self.operator, self.agent):
            self.refused(401, lambda: self.f.store.call("GET", "/v1/me", token=token))

    def test_handle_history_and_wallet_permanent(self):
        self.f.store.call("PATCH", "/v1/agents/" + self.agent_id, {"handle": "renamed_agent"}, self.agent)
        self.refused(409, lambda: self.f.agent(self.operator), "HANDLE_RESERVED")
        self.refused(400, lambda: self.f.store.call("PATCH", "/v1/agents/" + self.agent_id, {"wallet": address("else")}, self.operator))
        self.refused(409, lambda: self.f.store.call("POST", "/v1/agents", {"handle": "new_handle", "wallet": address("agent_one"), "capabilities": ["research"]}, self.operator))
        self.assertEqual(self.f.store.call("GET", "/v1/status")[1]["counts"]["agents"], 1)

    def test_concurrent_duplicate_wallet_registers_once(self):
        def register(number):
            try:
                self.f.store.call("POST", "/v1/agents", {"handle": "racer_" + str(number), "wallet": address("race"), "capabilities": ["research"]}, self.operator)
                return "APPLIED"
            except Problem as problem:
                return problem.code
        with ThreadPoolExecutor(max_workers=8) as pool:
            outcomes = list(pool.map(register, range(8)))
        self.assertEqual(outcomes.count("APPLIED"), 1)
        self.assertEqual(outcomes.count("RECORD_CONFLICT"), 7)
        self.assertEqual(self.f.store.call("GET", "/v1/status")[1]["counts"]["agents"], 2)
        self.f.store.audit()

    def test_failure_after_insert_rolls_back_everything(self):
        before = self.f.store.audit()
        with patch.object(self.f.store, "_event", side_effect=RuntimeError("injected storage failure")):
            with self.assertRaises(RuntimeError):
                self.f.store.call("POST", "/v1/agents", {"handle": "failed_agent", "wallet": address("failed"), "capabilities": ["research"]}, self.operator)
        self.assertEqual(before, self.f.store.audit())
        with closing(sqlite3.connect(self.f.store.path, autocommit=True)) as connection:
            for table in ("agents", "handles"):
                self.assertEqual(connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0], 1)
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM credentials").fetchone()[0], 3)

    def test_atomic_rotation_failure_keeps_old_token(self):
        with patch.object(self.f.store, "_event", side_effect=RuntimeError("audit failure")):
            with self.assertRaises(RuntimeError):
                self.f.store.call("POST", "/v1/credentials/rotate", {}, self.agent)
        self.assertEqual(self.f.store.call("GET", "/v1/me", token=self.agent)[0], 200)

    def test_handle_bound_and_failed_update_does_not_claim_handle(self):
        route = "/v1/agents/" + self.agent_id
        self.refused(400, lambda: self.f.store.call("PATCH", route, {"handle": "not_reserved", "bio": "x" * 513}, self.agent))
        self.f.store.call("PATCH", route, {"handle": "not_reserved"}, self.agent)
        for index in range(30):
            self.f.store.call("PATCH", route, {"handle": "history_" + str(index)}, self.agent)
        self.refused(409, lambda: self.f.store.call("PATCH", route, {"handle": "history_overflow"}, self.agent), "HANDLE_HISTORY_LIMIT")

    def test_membership_artifact_and_offer_ownership(self):
        _, other_operator = self.f.operator("operator_two")
        other_id, other = self.f.agent(other_operator, "agent_two")
        project = self.f.project(self.agent)
        route = "/v1/projects/" + project
        artifact = {"digest": "a" * 64, "title": "Research output"}
        self.refused(403, lambda: self.f.store.call("POST", route + "/artifacts", artifact, other))
        self.refused(403, lambda: self.f.store.call("POST", route + "/members", {"agent_id": other_id}, other))
        self.f.store.call("POST", route + "/members", {"agent_id": other_id}, self.agent)
        self.assertEqual(self.f.store.call("POST", route + "/artifacts", artifact, other)[1]["author_id"], other_id)
        self.refused(409, lambda: self.f.store.call("POST", route + "/artifacts", artifact, self.agent))
        offer = self.f.store.call("POST", "/v1/offers", {"project_id": project, "title": "Review", "criteria_digest": "b" * 64, "quote": "Terms to be agreed", "delivery_terms": "One report"}, other)[1]
        self.refused(403, lambda: self.f.store.call("PATCH", "/v1/offers/" + offer["id"], {"active": False}, self.agent))
        self.f.store.call("PATCH", "/v1/agents/" + other_id, {"active": False}, other_operator)
        observed = self.f.store.call("GET", "/v1/offers/" + offer["id"])[1]
        self.assertTrue(observed["active"])
        self.assertFalse(observed["available"])

    def test_reply_requires_same_scope_and_known_parent(self):
        project = self.f.project(self.agent)
        post = self.f.store.call("POST", "/v1/posts", {"body": "global"}, self.agent)[1]
        self.refused(409, lambda: self.f.store.call("POST", "/v1/posts", {"body": "wrong", "project_id": project, "reply_to": post["id"]}, self.agent), "REPLY_SCOPE_MISMATCH")
        self.refused(404, lambda: self.f.store.call("POST", "/v1/posts", {"body": "unknown", "reply_to": "0" * 32}, self.agent))
        self.assertEqual(self.f.store.call("POST", "/v1/posts", {"body": "reply", "reply_to": post["id"]}, self.agent)[0], 201)

    def test_post_rate_persists_across_restart_and_expires_exactly(self):
        for _ in range(6):
            self.f.store.call("POST", "/v1/posts", {"body": "one"}, self.agent)
        restarted = Store(self.f.state, clock=lambda: self.f.at)
        self.refused(429, lambda: restarted.call("POST", "/v1/posts", {"body": "seven"}, self.agent), "POST_RATE_LIMIT")
        self.f.at += 60_000
        self.assertEqual(restarted.call("POST", "/v1/posts", {"body": "next minute"}, self.agent)[0], 201)

    def test_write_rate_cannot_be_bypassed_by_credential_rotation(self):
        for _ in range(60):
            self.f.store.call("PATCH", "/v1/agents/" + self.agent_id, {"bio": "updated"}, self.agent)
        self.refused(429, lambda: self.f.store.call("POST", "/v1/credentials/rotate", {}, self.agent), "WRITE_RATE_LIMIT")

    def test_storage_bound_rejects_before_any_partial_change(self):
        before = self.f.store.audit()
        with patch.dict(LIMITS, {"credentials": 3}):
            self.refused(409, lambda: self.f.agent(self.operator, "overflow_agent"), "STORAGE_LIMIT")
        self.assertEqual(self.f.store.audit(), before)
        self.assertEqual(len(self.f.store.call("GET", "/v1/agents")[1]["items"]), 1)

    def test_pagination_and_observed_action_vs_declared_content(self):
        self.f.agent(self.operator, "agent_two")
        page = self.f.store.call("GET", "/v1/agents", limit=1)[1]
        next_page = self.f.store.call("GET", "/v1/agents", limit=1, after=page["next_after"])[1]
        self.assertNotEqual(page["items"][0]["id"], next_page["items"][0]["id"])
        self.assertIsNone(next_page["next_after"])
        row = page["items"][0]
        self.assertEqual(row["provenance"]["classification"], "OBSERVED")
        self.assertEqual(row["content_classification"], "LABEL")
        self.assertEqual(row["wallet_status"], "DECLARED_UNVERIFIED")
        self.assertIsNone(row["provenance"]["slot"])
        self.refused(400, lambda: self.f.store.call("GET", "/v1/agents", limit=True))

    def test_backup_restart_and_no_overwrite(self):
        self.f.project(self.agent)
        destination = self.f.root / "backup.sqlite3"
        self.f.store.backup(destination)
        restore = self.f.root / "restore"
        restore.mkdir(mode=0o700)
        destination.replace(restore / "community.sqlite3")
        restored = Store(restore, clock=lambda: self.f.at)
        self.assertEqual(restored.audit(), self.f.store.audit())
        self.assertEqual(restored.call("GET", "/v1/me", token=self.agent)[0], 200)
        with self.assertRaises(FileExistsError):
            self.f.store.backup(restore / "community.sqlite3")

    def test_audit_detects_chain_changes(self):
        with closing(sqlite3.connect(self.f.store.path, autocommit=True)) as connection:
            connection.execute("UPDATE audit SET details='{}' WHERE action='AGENT_REGISTER'")
        self.refused(503, self.f.store.audit, "AUDIT_CHAIN_FAILURE")

    def test_relationship_audit_detects_missing_reserved_handle(self):
        with closing(sqlite3.connect(self.f.store.path, autocommit=True)) as connection:
            connection.execute("DELETE FROM handles WHERE agent_id=?", (self.agent_id,))
        self.refused(503, self.f.store.audit, "RELATIONSHIP_FAILURE")

    def test_clock_regression_fails_closed(self):
        self.f.at -= 1
        self.refused(503, lambda: self.f.store.call("POST", "/v1/posts", {"body": "time"}, self.agent), "CLOCK_REGRESSION")

    def test_unknown_schema_and_missing_state_fail_without_create(self):
        with closing(sqlite3.connect(self.f.store.path, autocommit=True)) as connection:
            connection.execute("PRAGMA user_version=2")
        self.refused(503, lambda: Store(self.f.state), "UNSUPPORTED_SCHEMA")
        missing = self.f.root / "missing"
        self.refused(503, lambda: Store(missing))
        self.assertFalse(missing.exists())

    def test_init_recovery_refuse_overwrite_and_remove_only_owned_files(self):
        raw = self.f.owner_path.read_bytes()
        with self.assertRaises(FileExistsError):
            Store.initialize(self.f.root / "failed_init", self.f.owner_path)
        self.assertEqual(self.f.owner_path.read_bytes(), raw)
        self.assertFalse((self.f.root / "failed_init").exists())
        before = self.f.store.audit()
        with self.assertRaises(FileExistsError):
            self.f.store.recover_owner(self.f.owner_path)
        self.assertEqual(before, self.f.store.audit())
        self.assertEqual(self.f.store.call("GET", "/v1/me", token=self.f.owner)[0], 200)

    @unittest.skipUnless(os.name == "posix", "Unix permission and symlink checks")
    def test_private_files_and_symlink_rejection(self):
        self.assertEqual(stat.S_IMODE(self.f.state.stat().st_mode), 0o700)
        self.assertEqual(stat.S_IMODE(self.f.store.path.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(self.f.owner_path.stat().st_mode), 0o600)
        os.chmod(self.f.store.path, 0o644)
        self.refused(503, lambda: Store(self.f.state), "UNSAFE_STATE_PERMISSIONS")
        os.chmod(self.f.store.path, 0o600)
        actual = self.f.state / "actual.sqlite3"
        self.f.store.path.rename(actual)
        self.f.store.path.symlink_to(actual)
        self.refused(503, lambda: Store(self.f.state), "UNSAFE_STATE_FILE")

    def test_strict_json_utf8_and_field_validation(self):
        for raw in (b'{"body":"a","body":"b"}', b'{"x":NaN}', b'[]', b'"no"', b'\xff', b'[' * 2000):
            self.refused(400, lambda: parse_json(raw))
        for body in ({"body": "\ud800"}, {"body": "\x00"}, {"body": "x" * 2049}, {"body": "ok", "actor": "owner"}):
            self.refused(400, lambda: self.f.store.call("POST", "/v1/posts", body, self.agent))
        self.refused(413, lambda: self.f.store.call("POST", "/v1/posts", {"body": "x" * 17000}, self.agent))

    def test_address_validation_is_not_control_proof(self):
        for value in ("bad", "0" * 32, "1" * 31, "1" * 33, "z" * 44):
            self.refused(400, lambda: wallet(value))
        self.assertEqual(wallet(address("valid")), address("valid"))

    def test_no_fund_actions_or_wallet_secrets(self):
        for path in ("/v1/payments", "/v1/trades", "/v1/refunds", "/v1/withdraw", "/v1/freeze"):
            self.refused(404, lambda: self.f.store.call("POST", path, {}, self.agent))
        self.refused(400, lambda: self.f.store.call("POST", "/v1/agents", {"handle": "secret_agent", "wallet": address("safe"), "capabilities": ["research"], "seed_phrase": "never accept"}, self.operator))


if __name__ == "__main__":
    unittest.main()
