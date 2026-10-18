"""Real database authorization, credential handoff, stale signals and safe projections."""

from contextlib import closing
import unittest
import uuid

from helpers import Fixture, signed_body
from zoora_community.jobs import SIGNAL_FRESH_MS, SIGNAL_INTERVAL_MS
from zoora_community.store import Store
from zoora_community.validation import Problem, canonical


class ActivityTests(unittest.TestCase):
    def setUp(self):
        self.f = Fixture()
        self.addCleanup(self.f.close)
        self.operator_id, self.operator = self.f.operator()
        self.agent_id, self.worker = self.f.agent(self.operator)
        # A real external signature creates a different credential for the same agent.
        challenge = self.f.store.call("POST", "/v1/wallet/login/challenges",
            {"wallet": self.f.store.call("GET", "/v1/agents/" + self.agent_id)[1]["wallet"]})[1]
        self.login = self.f.store.call("POST", "/v1/wallet/login", signed_body(challenge, "agent_one"))[1]["credential"]
        self.route = "/v1/agents/" + self.agent_id + "/activity"

    def submit(self, token=None):
        return self.f.store.call("POST", "/v1/jobs", {"request_id": uuid.uuid4().hex,
            "title": "<script>hostile title</script>", "prompt": "PRIVATE PROMPT MUST NOT LEAK"}, token or self.login["token"])[1]["job"]

    def claim(self):
        return self.f.store.call("POST", "/v1/jobs/claim", {"max_steps": 4, "timeout_seconds": 60}, self.worker)[1]

    def activity(self, token=None):
        return self.f.store.call("GET", self.route, token=token or self.login["token"])[1]

    def pulse(self, claim, sequence=1, token=None, **changes):
        return self.f.store.call("POST", "/v1/jobs/" + claim["job"]["id"] + "/heartbeat",
            {"attempt_id": claim["job"]["attempt_id"], "claim_token": claim["claim_token"], "sequence": sequence, **changes}, token or self.worker)[1]

    def complete(self, claim, token=None):
        return self.f.store.call("POST", "/v1/jobs/" + claim["job"]["id"] + "/complete",
            {"attempt_id": claim["job"]["attempt_id"], "claim_token": claim["claim_token"],
             "state": "SUCCEEDED", "report_sha256": "a" * 64, "report_bytes": 50, "steps": 1, "error_code": None}, token or self.worker)[1]

    def denied(self, code, callback):
        with self.assertRaises(Problem) as error:
            callback()
        self.assertEqual(error.exception.code, code)

    def test_private_projection_scopes_owner_operator_and_agent(self):
        self.submit()
        self.denied("UNAUTHORIZED", lambda: self.f.store.call("GET", self.route))
        _, other_operator = self.f.operator("other_operator")
        _, other_agent = self.f.agent(other_operator, "other_agent")
        for token in (other_operator, other_agent):
            self.denied("FORBIDDEN", lambda token=token: self.activity(token))
        for token in (self.worker, self.login["token"], self.operator, self.f.owner):
            view = self.activity(token)
            self.assertEqual(view["agent"]["id"], self.agent_id)
            self.assertEqual(view["runtime"]["state"], "WAITING_FOR_WORKER")
            self.assertNotIn("PRIVATE PROMPT", canonical(view))
            self.assertNotIn(self.worker, canonical(view))
            self.assertNotIn("credential_id", canonical(view))
        self.denied("INVALID_PAGINATION", lambda: self.f.store.call("GET", self.route, token=self.worker, after=uuid.uuid4().hex))

    def test_wallet_session_tasks_are_claimed_by_same_agent_host_credential(self):
        job = self.submit()
        claim = self.claim()
        self.assertEqual(claim["job"]["id"], job["id"])
        self.assertEqual(claim["job"]["credential_id"], self.login["credential_id"])
        self.assertNotEqual(claim["job"]["worker_credential_id"], self.login["credential_id"])
        self.assertEqual(self.activity()["runtime"]["state"], "RUNNING_UNCONFIRMED")
        self.denied("JOB_CLAIM_MISMATCH", lambda: self.pulse(claim, token=self.login["token"]))
        self.denied("JOB_CLAIM_MISMATCH", lambda: self.complete(claim, self.login["token"]))
        self.pulse(claim)
        self.complete(claim)
        self.assertEqual(self.activity()["runtime"]["counts"]["SUCCEEDED"], 1)
        self.assertEqual(self.activity()["runtime"]["state"], "IDLE")
        self.f.store.audit()

    def test_other_agent_cannot_claim_wallet_session_job(self):
        self.submit()
        _, other = self.f.agent(self.operator, "other_agent")
        result = self.f.store.call("POST", "/v1/jobs/claim", {"max_steps": 4, "timeout_seconds": 60}, other)[1]
        self.assertIsNone(result["job"])
        self.assertIsNotNone(self.claim()["job"])

    def test_check_in_replay_does_not_refresh_time_or_extend_lease(self):
        self.submit()
        claim = self.claim()
        first = self.pulse(claim)
        self.assertFalse(first["replayed"])
        self.assertEqual(self.activity()["runtime"]["state"], "WORKER_SEEN")
        self.f.at += SIGNAL_FRESH_MS
        replay = self.pulse(claim)
        self.assertTrue(replay["replayed"])
        self.assertEqual(replay["signal"], first["signal"])
        self.assertEqual(self.activity()["runtime"]["state"], "RUNNING_UNCONFIRMED")
        self.assertEqual(self.activity()["jobs"][0]["lease_expires_ms"], claim["job"]["lease_expires_ms"])
        self.pulse(claim, 2)
        self.assertEqual(self.activity()["runtime"]["state"], "WORKER_SEEN")
        self.f.store.audit()

    def test_freshness_survives_restart_and_expires_at_boundary(self):
        self.submit()
        claim = self.claim()
        self.pulse(claim)
        self.f.store = Store(self.f.state, clock=lambda: self.f.at)
        self.f.at += SIGNAL_FRESH_MS - 1
        self.assertEqual(self.activity()["runtime"]["state"], "WORKER_SEEN")
        self.f.at += 1
        self.assertEqual(self.activity()["runtime"]["state"], "RUNNING_UNCONFIRMED")
        self.f.at = claim["job"]["lease_expires_ms"]
        self.assertEqual(self.activity()["runtime"]["counts"]["INTERRUPTED"], 1)
        self.denied("JOB_NOT_RUNNING", lambda: self.pulse(claim, 2))

    def test_signal_claim_sequence_and_rate_are_deterministic(self):
        self.submit()
        claim = self.claim()
        self.denied("JOB_CLAIM_MISMATCH", lambda: self.pulse(claim, attempt_id=uuid.uuid4().hex))
        self.denied("JOB_CLAIM_MISMATCH", lambda: self.pulse(claim, claim_token="jr1_" + "x" * 43))
        for sequence in (True, 0, 25):
            self.denied("INVALID_JOB_SIGNAL", lambda sequence=sequence: self.pulse(claim, sequence))
        self.denied("JOB_SIGNAL_SEQUENCE", lambda: self.pulse(claim, 2))
        self.pulse(claim)
        self.denied("JOB_SIGNAL_TOO_SOON", lambda: self.pulse(claim, 2))
        self.f.at += SIGNAL_INTERVAL_MS
        self.pulse(claim, 2)
        self.denied("JOB_SIGNAL_SEQUENCE", lambda: self.pulse(claim, 1))
        self.f.store.audit()

    def test_revoking_submitter_interrupts_same_agent_worker_attempt(self):
        self.submit()
        claim = self.claim()
        self.pulse(claim)
        self.f.store.call("POST", "/v1/credentials/rotate", {}, self.login["token"])
        view = self.activity(self.worker)
        self.assertEqual(view["runtime"]["counts"]["INTERRUPTED"], 1)
        self.denied("JOB_NOT_RUNNING", lambda: self.pulse(claim, 2))

    def test_revoking_worker_interrupts_attempt_for_still_valid_login(self):
        self.submit()
        claim = self.claim()
        self.pulse(claim)
        self.f.store.call("POST", "/v1/credentials/rotate", {}, self.worker)
        self.assertEqual(self.activity()["runtime"]["counts"]["INTERRUPTED"], 1)
        self.denied("UNAUTHORIZED", lambda: self.pulse(claim, 2))

    def test_stop_prevents_further_check_ins_and_overrides_fresh_signal(self):
        self.submit()
        claim = self.claim()
        self.pulse(claim)
        self.f.store.call("POST", "/v1/jobs/" + claim["job"]["id"] + "/stop", {}, self.operator)
        self.assertEqual(self.activity()["runtime"]["state"], "STOP_REQUESTED")
        self.denied("JOB_STOPPED", lambda: self.pulse(claim, 2))
        self.complete(claim)
        self.assertEqual(self.activity()["runtime"]["counts"]["CANCELLED"], 1)
        self.f.store.audit()

    def test_snapshot_reads_do_not_mutate_or_contact_chain(self):
        before = self.f.store.audit()
        self.f.store.rpc = object()  # Any attempted RPC operation would fail.
        self.submit()
        for _ in range(3):
            view = self.activity()
            self.assertEqual(view["blockchain"]["work_storage"], "SERVICE_DATABASE")
            self.assertEqual(view["blockchain"]["observations"], [])
            self.assertFalse(view["blockchain"]["rpc_health_checked"])
        after = self.f.store.audit()
        self.assertEqual(after["audit_events"], before["audit_events"] + 1)

    def test_audit_rejects_rehashed_signal_with_wrong_attempt(self):
        self.submit()
        claim = self.claim()
        with closing(self.f.store._connection()) as connection:
            connection.execute("BEGIN IMMEDIATE")
            self.f.store._event(connection, {"role": "AGENT", "principal_id": self.agent_id}, "JOB_HEARTBEAT",
                claim["job"]["id"], {"attempt_id": uuid.uuid4().hex, "sequence": 1}, self.f.at)
            connection.execute("COMMIT")
        self.denied("JOB_CONSISTENCY_FAILURE", self.f.store.audit)

    def test_legacy_claim_events_without_worker_field_still_audit(self):
        # Existing schema-7 databases can contain old claim envelopes.
        job = self.submit(self.worker)
        with closing(self.f.store._connection()) as connection:
            connection.execute("BEGIN IMMEDIATE")
            from zoora_community.jobs import LEASE_GRACE_MS, claim_digest
            attempt = uuid.uuid4().hex
            connection.execute("UPDATE jobs SET state='RUNNING',attempt_id=?,claim_digest=?,lease_expires_ms=?,run_max_steps=4,run_timeout_seconds=60,updated_ms=? WHERE id=?",
                (attempt, claim_digest("jr1_" + "x" * 43), self.f.at + 60_000 + LEASE_GRACE_MS, self.f.at, job["id"]))
            self.f.store._event(connection, {"role": "AGENT", "principal_id": self.agent_id}, "JOB_CLAIM", job["id"],
                {"attempt_id": attempt, "max_steps": 4, "timeout_seconds": 60}, self.f.at)
            connection.execute("COMMIT")
        self.assertEqual(self.claim()["job"], None)
        self.f.store.audit()


if __name__ == "__main__":
    unittest.main()
