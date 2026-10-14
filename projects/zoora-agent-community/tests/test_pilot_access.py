"""Real SQLite access grants, revocation, rollback, expiry and suspension scope."""

from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
import secrets
import sqlite3
import unittest
from unittest.mock import patch
import uuid

from helpers import Fixture
from zoora_community.pilot_access import CLAIM_RETRY_MS, MAX_PENDING, claimed_token
from zoora_community.recovery import restore_backup, verify_backup
from zoora_community.store import LIMITS, Store
from zoora_community.validation import Problem, canonical


class PilotAccessTests(unittest.TestCase):
    def setUp(self):
        self.f = Fixture()
        self.addCleanup(self.f.close)
        self.operator_id, self.operator = self.f.operator()
        self.agent_id, self.agent = self.f.agent(self.operator)
        self.body = {"request_id": uuid.uuid4().hex, "label": "Private pilot invitation", "ttl_seconds": 3600}

    def refused(self, code, callback):
        with self.assertRaises(Problem) as result:
            callback()
        self.assertEqual(result.exception.code, code)

    def invite(self, body=None, token=None):
        return self.f.store.call("POST", "/v1/invitations", self.body if body is None else body, token or self.f.owner)[1]

    def claim_body(self, invite, **changes):
        return {"invitation_token": invite["secret"]["token"], "handle": "invited_operator",
                "claim_nonce": "icn1_" + secrets.token_urlsafe(32), **changes}

    def claim(self, body):
        return self.f.store.call("POST", "/v1/invitations/claim", body)[1]

    def suspend(self, table, record_id, token=None, action="suspend", reason="Pilot access review"):
        return self.f.store.call("POST", "/v1/" + table + "/" + record_id + "/" + action,
                                 {"reason": reason}, token or self.f.owner)[1]

    def job(self):
        return self.f.store.call("POST", "/v1/jobs", {"request_id": uuid.uuid4().hex, "title": "Private task", "prompt": "Private prompt"}, self.agent)[1]["job"]

    def test_owner_only_creation_private_lists_and_no_role_escalation(self):
        for token in (self.agent, self.operator):
            self.refused("FORBIDDEN", lambda token=token: self.invite(token=token))
            for route in ("/v1/invitations", "/v1/operators"):
                self.refused("FORBIDDEN", lambda token=token, route=route: self.f.store.call("GET", route, token=token))
        for route in ("/v1/invitations", "/v1/operators", "/v1/managed-agents"):
            self.refused("UNAUTHORIZED", lambda route=route: self.f.store.call("GET", route))
        invitation = self.invite()
        body = self.claim_body(invitation)
        self.refused("INVALID_FIELDS", lambda: self.claim({**body, "role": "OWNER"}))
        result = self.claim(body)
        self.assertEqual(result["credential"]["role"], "OPERATOR")
        self.assertEqual(self.f.store.call("GET", "/v1/me", token=result["credential"]["token"])[1]["role"], "OPERATOR")
        self.refused("FORBIDDEN", lambda: self.invite(token=result["credential"]["token"]))
        self.assertEqual(self.f.store.call("GET", "/v1/invitations", token=self.f.owner)[1]["items"][0]["state"], "CLAIMED")
        self.f.store.audit()

    def test_create_retry_does_not_create_second_secret_or_invitation(self):
        first = self.invite()
        again = self.invite()
        self.assertTrue(again["replayed"])
        self.assertIsNone(again["secret"])
        self.assertEqual(first["invitation"], again["invitation"])
        self.refused("INVITATION_REQUEST_CONFLICT", lambda: self.invite({**self.body, "label": "Different request"}))
        self.assertEqual(len(self.f.store.call("GET", "/v1/invitations", token=self.f.owner)[1]["items"]), 1)

    def test_concurrent_claim_and_exact_lost_response_retry_issue_one_credential(self):
        invitation = self.invite()
        body = self.claim_body(invitation)
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(lambda _: self.claim(body), range(8)))
        self.assertEqual(sum(not result["replayed"] for result in results), 1)
        self.assertEqual(len({result["credential"]["credential_id"] for result in results}), 1)
        self.assertTrue(all(result["credential"] == results[0]["credential"] for result in results))
        self.assertEqual(results[0]["credential"]["token"], claimed_token(body))
        self.refused("INVITATION_UNAVAILABLE", lambda: self.claim({**body, "claim_nonce": "icn1_" + secrets.token_urlsafe(32)}))
        self.refused("INVITATION_UNAVAILABLE", lambda: self.claim({**body, "handle": "different_handle"}))
        self.f.store.audit()

    def test_competing_claims_only_one_new_account(self):
        invite = self.invite()
        bodies = [self.claim_body(invite, handle="recipient_" + str(i)) for i in range(8)]

        def claim(body):
            try:
                return self.claim(body)["credential"]["principal_id"]
            except Problem as exc:
                return exc.code

        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(claim, bodies))
        self.assertEqual(results.count("INVITATION_UNAVAILABLE"), 7)
        self.f.store.audit()

    def test_expired_revoked_creator_rotated_and_unknown_invitations_fail(self):
        invite = self.invite()
        body = self.claim_body(invite)
        self.refused("INVITATION_UNAVAILABLE", lambda: self.claim({**body, "invitation_token": "zi1_" + secrets.token_urlsafe(32)}))
        self.f.store.call("POST", "/v1/invitations/" + invite["invitation"]["id"] + "/revoke", {}, self.f.owner)
        self.refused("INVITATION_UNAVAILABLE", lambda: self.claim(body))
        another = self.invite({**self.body, "request_id": uuid.uuid4().hex, "ttl_seconds": 300})
        self.f.at += 300_000
        self.refused("INVITATION_UNAVAILABLE", lambda: self.claim(self.claim_body(another)))
        fresh = self.invite({**self.body, "request_id": uuid.uuid4().hex})
        owner = self.f.store.call("POST", "/v1/credentials/rotate", {}, self.f.owner)[1]["credential"]["token"]
        self.refused("INVITATION_UNAVAILABLE", lambda: self.claim(self.claim_body(fresh)))
        states = {row["id"]: row["state"] for row in self.f.store.call("GET", "/v1/invitations", token=owner)[1]["items"]}
        self.assertEqual(states[invite["invitation"]["id"]], "REVOKED")
        self.assertEqual(states[fresh["invitation"]["id"]], "CREATOR_CREDENTIAL_INVALID")
        self.f.store.audit()

    def test_claim_retry_window_does_not_extend_expiry_and_rotation_blocks_recovery(self):
        invitation = self.invite()
        body = self.claim_body(invitation)
        first = self.claim(body)
        self.f.at += CLAIM_RETRY_MS - 1
        self.assertEqual(self.claim(body)["credential"], first["credential"])
        self.f.at += 1
        self.refused("INVITATION_UNAVAILABLE", lambda: self.claim(body))
        another = self.invite({**self.body, "request_id": uuid.uuid4().hex})
        other_body = self.claim_body(another, handle="another_recipient")
        recipient = self.claim(other_body)["credential"]["token"]
        self.f.store.call("POST", "/v1/credentials/rotate", {}, recipient)
        self.refused("UNAUTHORIZED", lambda: self.claim(other_body))

    def test_secrets_never_persist_or_appear_in_lists_and_audit(self):
        invitation = self.invite()
        body = self.claim_body(invitation)
        credential = self.claim(body)["credential"]
        raw = self.f.store.path.read_bytes()
        visible = canonical(self.f.store.call("GET", "/v1/invitations", token=self.f.owner)[1]) + canonical(self.f.store.call("GET", "/v1/audit", token=self.f.owner)[1])
        for token in (body["invitation_token"], body["claim_nonce"], credential["token"], self.f.owner):
            self.assertNotIn(token.encode(), raw)
            self.assertNotIn(token, visible)

    def test_invalid_fields_and_bounds_do_not_consume_invitation(self):
        for change in ({"ttl_seconds": True}, {"ttl_seconds": 299}, {"ttl_seconds": 86401}, {"label": ""}, {"role": "OWNER"}):
            with self.assertRaises(Problem):
                self.invite({**self.body, **change})
        invitation = self.invite()
        body = self.claim_body(invitation)
        for change in ({"claim_nonce": "bad"}, {"handle": "invalid/handle"}, {"wallet_private_key": "never accepted"}):
            with self.assertRaises(Problem):
                self.claim({**body, **change})
        self.refused("INVITATION_ONLY_AUTH", lambda: self.f.store.call("POST", "/v1/invitations/claim", body, self.f.owner))
        self.assertEqual(self.claim(body)["credential"]["role"], "OPERATOR")

    def test_duplicate_handle_and_audit_failure_roll_back_consumption(self):
        invitation = self.invite()
        body = self.claim_body(invitation, handle="operator_one")
        self.refused("RECORD_CONFLICT", lambda: self.claim(body))
        original = self.f.store._event

        def fail(connection, principal, action, *args):
            if action == "INVITATION_CLAIM":
                raise RuntimeError("injected audit failure")
            return original(connection, principal, action, *args)

        body = {**body, "handle": "safe_recipient"}
        before = self.f.store.audit()
        with patch.object(self.f.store, "_event", side_effect=fail), self.assertRaises(RuntimeError):
            self.claim(body)
        self.assertEqual(self.f.store.audit(), before)
        self.assertEqual(self.claim(body)["credential"]["role"], "OPERATOR")

    def test_invitation_capacity_and_pending_quota(self):
        with patch.dict(LIMITS, invitations=1):
            self.invite()
            self.refused("STORAGE_LIMIT", lambda: self.invite({**self.body, "request_id": uuid.uuid4().hex}))
        for _ in range(MAX_PENDING - 1):
            self.invite({**self.body, "request_id": uuid.uuid4().hex})
        self.refused("INVITATION_PENDING_LIMIT", lambda: self.invite({**self.body, "request_id": uuid.uuid4().hex}))

    def test_owner_agent_suspension_cannot_be_lifted_or_bypassed_by_operator(self):
        self.suspend("agents", self.agent_id)
        self.refused("UNAUTHORIZED", lambda: self.f.store.call("GET", "/v1/me", token=self.agent))
        self.refused("OWNER_SUSPENSION_REQUIRED", lambda: self.suspend("agents", self.agent_id, self.operator, action="resume"))
        self.refused("ACCESS_SUSPENDED", lambda: self.f.store.call("PATCH", "/v1/agents/" + self.agent_id, {"active": True}, self.operator))
        self.refused("ACCESS_SUSPENDED", lambda: self.f.store.call("POST", "/v1/agents/" + self.agent_id + "/credentials", {}, self.operator))
        self.suspend("agents", self.agent_id, action="resume")
        self.refused("UNAUTHORIZED", lambda: self.f.store.call("GET", "/v1/me", token=self.agent))
        fresh = self.f.store.call("POST", "/v1/agents/" + self.agent_id + "/credentials", {}, self.operator)[1]["credential"]["token"]
        self.assertEqual(self.f.store.call("GET", "/v1/me", token=fresh)[1]["principal_id"], self.agent_id)
        self.f.store.audit()

    def test_operator_scope_and_agent_tokens_cannot_moderate(self):
        _, other = self.f.operator("other_operator")
        for token in (other, self.agent):
            self.refused("FORBIDDEN", lambda token=token: self.suspend("agents", self.agent_id, token))
        self.refused("FORBIDDEN", lambda: self.suspend("operators", self.operator_id, self.operator))
        self.suspend("agents", self.agent_id, self.operator)
        self.suspend("agents", self.agent_id, self.operator, action="resume")
        self.f.store.audit()

    def test_operator_suspension_revokes_descendants_and_retires_jobs_atomically(self):
        running = self.job()
        self.f.store.call("POST", "/v1/jobs/claim", {"max_steps": 4, "timeout_seconds": 60}, self.agent)
        queued = self.job()
        self.suspend("operators", self.operator_id)
        for token in (self.operator, self.agent):
            self.refused("UNAUTHORIZED", lambda token=token: self.f.store.call("GET", "/v1/me", token=token))
        for record, state in ((running, "INTERRUPTED"), (queued, "CANCELLED")):
            result = self.f.store.call("GET", "/v1/jobs/" + record["id"], token=self.f.owner)[1]
            self.assertEqual(result["state"], state)
            self.assertEqual(result["recorded_state"], state)
        self.f.store.call("PATCH", "/v1/operators/" + self.operator_id, {"active": True}, self.f.owner)
        self.refused("ACCESS_SUSPENDED", lambda: self.f.store.call("POST", "/v1/operators/" + self.operator_id + "/credentials", {}, self.f.owner))
        self.suspend("operators", self.operator_id, action="resume")
        self.refused("UNAUTHORIZED", lambda: self.f.store.call("GET", "/v1/me", token=self.operator))
        fresh = self.f.store.call("POST", "/v1/operators/" + self.operator_id + "/credentials", {}, self.f.owner)[1]["credential"]["token"]
        self.assertEqual(self.f.store.call("GET", "/v1/me", token=fresh)[1]["role"], "OPERATOR")
        self.f.store.audit()

    def test_suspend_failure_rolls_back_revocation_holds_and_job_state(self):
        job = self.job()
        original = self.f.store._event

        def fail(connection, principal, action, *args):
            if action == "ACCESS_SUSPEND":
                raise RuntimeError("injected failure")
            return original(connection, principal, action, *args)

        before = self.f.store.audit()
        with patch.object(self.f.store, "_event", side_effect=fail), self.assertRaises(RuntimeError):
            self.suspend("operators", self.operator_id)
        self.assertEqual(self.f.store.audit(), before)
        self.assertEqual(self.f.store.call("GET", "/v1/me", token=self.agent)[1]["role"], "AGENT")
        self.assertEqual(self.f.store.call("GET", "/v1/jobs/" + job["id"], token=self.agent)[1]["state"], "QUEUED")

    def test_managed_lists_exclude_other_operators_and_reasons_are_private(self):
        _, other = self.f.operator("other_operator")
        self.assertEqual(self.f.store.call("GET", "/v1/managed-agents", token=other)[1]["items"], [])
        self.refused("FORBIDDEN", lambda: self.f.store.call("GET", "/v1/managed-agents", token=self.agent))
        reason = "Private moderation reason"
        self.suspend("agents", self.agent_id, reason=reason)
        private = self.f.store.call("GET", "/v1/managed-agents", token=self.operator)[1]["items"][0]
        self.assertEqual(private["reason"], reason)
        self.assertEqual(private["suspension_controller"], "OWNER")
        public = canonical(self.f.store.call("GET", "/v1/agents")[1])
        self.assertNotIn(reason, public)

    def test_backup_restore_preserves_claim_and_hold_and_recovery_blocks_old_invites(self):
        invitation = self.invite()
        body = self.claim_body(invitation)
        self.claim(body)
        self.suspend("agents", self.agent_id)
        backup = self.f.root / "pilot-backup.sqlite3"
        self.f.store.backup(backup)
        self.assertEqual(verify_backup(backup)["audit"], self.f.store.audit())
        restored = self.f.root / "restored"
        restore_backup(backup, restored)
        self.f.store = Store(restored, clock=lambda: self.f.at)
        self.assertTrue(self.claim(body)["replayed"])
        self.refused("OWNER_SUSPENSION_REQUIRED", lambda: self.suspend("agents", self.agent_id, self.operator, action="resume"))
        self.f.store.recover_owner(self.f.root / "new-owner.json", invalidate_all=True)
        self.refused("INVITATION_UNAVAILABLE", lambda: self.claim(body))
        self.f.store.audit()

    def test_audit_rejects_modified_invitation_label_and_hold_reason(self):
        invitation = self.invite()
        self.suspend("agents", self.agent_id)
        with closing(sqlite3.connect(self.f.store.path)) as connection:
            connection.execute("UPDATE invitations SET label='Tampered label' WHERE id=?", (invitation["invitation"]["id"],))
            connection.commit()
        self.refused("PILOT_ACCESS_CONSISTENCY_FAILURE", self.f.store.audit)
        with closing(sqlite3.connect(self.f.store.path)) as connection:
            connection.execute("UPDATE invitations SET label=? WHERE id=?", (self.body["label"], invitation["invitation"]["id"]))
            connection.execute("UPDATE access_holds SET reason='Tampered reason'")
            connection.commit()
        self.refused("PILOT_ACCESS_CONSISTENCY_FAILURE", self.f.store.audit)
