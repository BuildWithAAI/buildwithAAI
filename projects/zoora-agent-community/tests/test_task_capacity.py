"""Shared admissions, durable policy, scope boundaries and atomic failure checks."""

from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
import hashlib
import json
import sqlite3
import threading
import unittest
from unittest.mock import patch
import uuid

from helpers import Fixture
from zoora_community.jobs import QUEUE_TTL_MS
from zoora_community.recovery import restore_backup, verify_backup
from zoora_community.store import AUDIT_DOMAIN, Store, ZERO_HASH
from zoora_community.validation import Problem, canonical


class TaskCapacityTests(unittest.TestCase):
    def setUp(self):
        self.f = Fixture()
        self.addCleanup(self.f.close)
        self.operator_id, self.operator = self.f.operator()
        self.agent_id, self.agent = self.f.agent(self.operator)
        self.alias_id, self.alias = self.f.agent(self.operator, "agent_alias")
        self.route = "/v1/operators/" + self.operator_id + "/task-capacity"

    def view(self, token=None):
        return self.f.store.call("GET", "/v1/task-capacity", token=token or self.agent)[1]

    def configure(self, maximum, revision=None, reason="Local queue resource policy", token=None):
        if revision is None:
            revision = self.f.store.call("GET", self.route, token=self.f.owner)[1]["revision"]
        return self.f.store.call("PATCH", self.route, {"max_pending": maximum,
                                 "expected_revision": revision, "reason": reason}, token or self.f.owner)[1]

    def submit(self, token=None, body=None):
        body = body or {"request_id": uuid.uuid4().hex, "title": "Task", "prompt": "Private fixture prompt"}
        return self.f.store.call("POST", "/v1/jobs", body, token or self.agent)[1]

    def claim(self):
        return self.f.store.call("POST", "/v1/jobs/claim", {"max_steps": 4, "timeout_seconds": 60}, self.agent)[1]

    def stop(self, job):
        return self.f.store.call("POST", "/v1/jobs/" + job["id"] + "/stop", {}, self.f.owner)[1]

    def refused(self, code, callback):
        with self.assertRaises(Problem) as caught:
            callback()
        self.assertEqual(caught.exception.code, code)

    def test_platform_only_default_preserves_existing_queue_contract(self):
        self.assertIsNone(self.view()["max_pending"])
        self.assertEqual(self.view()["revision"], 0)
        for _ in range(4):
            self.submit()
        self.refused("JOB_QUEUE_LIMIT", self.submit)
        self.assertEqual(self.view()["pending"], 4)
        self.f.store.audit()

    def test_private_read_scope_never_accepts_another_operator(self):
        other_id, other = self.f.operator("other_operator")
        _, other_agent = self.f.agent(other, "other_agent")
        self.refused("UNAUTHORIZED", lambda: self.f.store.call("GET", self.route))
        for token in (other, other_agent):
            self.refused("FORBIDDEN", lambda token=token: self.f.store.call("GET", self.route, token=token))
        for token in (self.agent, self.operator, self.f.owner):
            self.assertEqual(self.f.store.call("GET", self.route, token=token)[1]["operator_id"], self.operator_id)
        self.assertEqual(self.view(other)["operator_id"], other_id)
        self.refused("OPERATOR_ID_REQUIRED", lambda: self.view(self.f.owner))
        self.assertEqual(self.view()["scope"], "PRIVATE_OPERATOR_TASK_CAPACITY")

    def test_only_owner_can_change_policy(self):
        for token in (self.agent, self.alias, self.operator):
            self.refused("FORBIDDEN", lambda token=token: self.configure(32, token=token))
        self.assertEqual(self.view()["revision"], 0)

    def test_invalid_values_and_unexpected_fields_leave_database_unchanged(self):
        before = self.f.store.path.read_bytes()
        values = [True, False, -1, 33, 1.0, "1", [], {}]
        for maximum in values:
            self.refused("INVALID_TASK_CAPACITY", lambda maximum=maximum: self.configure(maximum))
        for revision in (True, -1, 50000, "0", 0.0):
            self.refused("INVALID_CAPACITY_REVISION", lambda revision=revision: self.configure(1, revision))
        self.refused("INVALID_FIELDS", lambda: self.f.store.call("PATCH", self.route,
                     {"max_pending": 1, "expected_revision": 0, "reason": "Policy", "tier": "TRUSTED"}, self.f.owner))
        self.assertEqual(before, self.f.store.path.read_bytes())

    def test_two_known_agents_share_one_operator_allowance(self):
        self.configure(1)
        self.submit()
        self.refused("OPERATOR_TASK_LIMIT", lambda: self.submit(self.alias))
        self.assertEqual((self.view()["pending"], self.view()["agent_pending"]), (1, 1))
        self.assertEqual((self.view(self.alias)["pending"], self.view(self.alias)["agent_pending"]), (1, 0))
        self.f.store.audit()

    def test_different_operator_retains_independent_allowance(self):
        self.configure(1)
        self.submit()
        _, other = self.f.operator("other_operator")
        _, other_agent = self.f.agent(other, "other_agent")
        self.submit(other_agent)
        self.assertEqual(self.view(other_agent)["pending"], 1)
        self.assertEqual(self.view()["pending"], 1)

    def test_queued_stop_frees_shared_capacity(self):
        self.configure(1)
        first = self.submit()["job"]
        self.assertEqual(self.stop(first)["state"], "CANCELLED")
        self.assertEqual(self.submit(self.alias)["job"]["state"], "QUEUED")

    def test_running_stop_holds_capacity_until_a_terminal_completion(self):
        self.configure(1)
        job = self.submit()["job"]
        claim = self.claim()
        self.assertEqual(self.stop(job)["state"], "RUNNING")
        self.refused("OPERATOR_TASK_LIMIT", lambda: self.submit(self.alias))
        self.f.store.call("POST", "/v1/jobs/" + job["id"] + "/complete",
                          {"attempt_id": claim["job"]["attempt_id"], "claim_token": claim["claim_token"],
                           "state": "FAILED", "report_sha256": None, "report_bytes": None,
                           "steps": 0, "error_code": "FIXTURE_FAILURE"}, self.agent)
        self.assertEqual(self.submit(self.alias)["job"]["state"], "QUEUED")
        self.f.store.audit()

    def test_successful_completion_releases_capacity(self):
        self.configure(1)
        job = self.submit()["job"]
        claim = self.claim()
        self.f.store.call("POST", "/v1/jobs/" + job["id"] + "/complete",
                          {"attempt_id": claim["job"]["attempt_id"], "claim_token": claim["claim_token"],
                           "state": "SUCCEEDED", "report_sha256": "a" * 64, "report_bytes": 100,
                           "steps": 1, "error_code": None}, self.agent)
        self.assertEqual(self.submit(self.alias)["job"]["state"], "QUEUED")
        self.f.store.audit()

    def test_expired_queue_is_excluded_before_a_sweep_is_persisted(self):
        self.configure(1)
        self.submit()
        self.f.at += QUEUE_TTL_MS
        self.assertEqual(self.view()["pending"], 0)
        self.assertEqual(self.submit(self.alias)["job"]["state"], "QUEUED")
        self.f.store.audit()

    def test_expired_running_lease_releases_shared_capacity(self):
        self.configure(1)
        self.submit()
        claim = self.claim()
        self.f.at = claim["job"]["lease_expires_ms"]
        self.assertEqual(self.view()["pending"], 0)
        self.submit(self.alias)
        self.f.store.audit()

    def test_revoked_job_credential_is_excluded_without_new_agent_identity(self):
        self.configure(1)
        self.submit()
        self.f.store.call("POST", "/v1/agents/" + self.agent_id + "/credentials", {}, self.operator)
        self.assertEqual(self.view(self.alias)["pending"], 0)
        self.submit(self.alias)
        self.f.store.audit()

    def test_lowering_limit_preserves_work_and_blocks_new_admission(self):
        self.configure(3)
        jobs = [self.submit()["job"], self.submit(self.alias)["job"]]
        result = self.configure(1)["capacity"]
        self.assertTrue(result["over_limit"])
        self.assertEqual(result["remaining_operator_allowance"], 0)
        self.refused("OPERATOR_TASK_LIMIT", self.submit)
        self.assertIsNotNone(self.claim()["job"])
        self.stop(jobs[1])
        self.refused("OPERATOR_TASK_LIMIT", lambda: self.submit(self.alias))
        self.f.store.audit()

    def test_zero_pauses_submissions_and_preserves_queued_execution(self):
        self.submit()
        self.configure(0)
        self.refused("OPERATOR_TASK_LIMIT", lambda: self.submit(self.alias))
        self.assertIsNotNone(self.claim()["job"])
        self.f.store.audit()

    def test_existing_request_reconciles_at_capacity_and_after_downgrade(self):
        body = {"request_id": uuid.uuid4().hex, "title": "Task", "prompt": "Private fixture prompt"}
        first = self.submit(body=body)
        self.configure(0)
        repeated = self.submit(body=body)
        self.assertEqual(first["job"]["id"], repeated["job"]["id"])
        self.assertTrue(repeated["replayed"])
        self.refused("JOB_REQUEST_CONFLICT", lambda: self.submit(body={**body, "title": "Changed"}))

    def test_clear_override_keeps_revision_and_refuses_stale_writes(self):
        self.configure(1, 0)
        result = self.configure(None, 1)["capacity"]
        self.assertEqual(result["revision"], 2)
        self.assertIsNone(result["max_pending"])
        self.refused("TASK_CAPACITY_CONFLICT", lambda: self.configure(1, 0))
        before = self.f.store.audit()
        self.assertFalse(self.configure(None, 2)["changed"])
        self.assertEqual(before, self.f.store.audit())
        self.submit()
        self.submit(self.alias)
        self.f.store.audit()

    def test_cross_agent_concurrent_submissions_have_one_winner(self):
        self.configure(1)
        barrier = threading.Barrier(8)

        def attempt(index):
            store = Store(self.f.state, clock=lambda: self.f.at)
            token = self.agent if index % 2 else self.alias
            body = {"request_id": uuid.uuid4().hex, "title": "Race", "prompt": "Fixture"}
            barrier.wait(timeout=10)
            try:
                return store.call("POST", "/v1/jobs", body, token)[0]
            except Problem as error:
                return error.code

        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(attempt, range(8)))
        self.assertEqual(results.count(201), 1)
        self.assertEqual(results.count("OPERATOR_TASK_LIMIT"), 7)
        self.assertEqual(self.view()["pending"], 1)
        self.f.store.audit()

    def test_concurrent_owner_changes_require_the_current_revision(self):
        with ThreadPoolExecutor(max_workers=2) as pool:
            def change(maximum):
                try:
                    return self.configure(maximum, 0)["capacity"]["revision"]
                except Problem as error:
                    return error.code
            results = list(pool.map(change, (1, 2)))
        self.assertEqual(results.count(1), 1)
        self.assertEqual(results.count("TASK_CAPACITY_CONFLICT"), 1)
        self.f.store.audit()

    def test_failed_audit_append_rolls_back_policy_and_admission(self):
        before = self.f.store.path.read_bytes()
        with patch.object(Store, "_event", side_effect=RuntimeError("injected failure")):
            with self.assertRaises(RuntimeError):
                self.configure(1)
        self.assertEqual(before, self.f.store.path.read_bytes())
        self.configure(1)
        before = self.f.store.path.read_bytes()
        with patch.object(Store, "_event", side_effect=RuntimeError("injected failure")):
            with self.assertRaises(RuntimeError):
                self.submit()
        self.assertEqual(before, self.f.store.path.read_bytes())
        self.f.store.audit()

    def test_restart_and_exclusive_backup_restore_preserve_policy_and_usage(self):
        self.configure(1)
        self.submit()
        backup = self.f.root / "capacity.sqlite3"
        self.f.store.backup(backup)
        self.assertEqual(verify_backup(backup)["audit"], self.f.store.audit())
        restored = self.f.root / "restored"
        restore_backup(backup, restored)
        for state in (self.f.state, restored):
            self.f.store = Store(state, clock=lambda: self.f.at)
            self.assertEqual((self.view()["revision"], self.view()["pending"]), (1, 1))
            self.refused("OPERATOR_TASK_LIMIT", lambda: self.submit(self.alias))
            self.f.store.audit()

    def test_policy_tamper_fails_audit_and_backup_publication(self):
        self.configure(1)
        with closing(sqlite3.connect(self.f.store.path, autocommit=True)) as connection:
            connection.execute("UPDATE operator_task_capacity SET max_pending=32")
        self.refused("TASK_CAPACITY_CONSISTENCY_FAILURE", self.f.store.audit)
        destination = self.f.root / "rejected.sqlite3"
        self.refused("TASK_CAPACITY_CONSISTENCY_FAILURE", lambda: self.f.store.backup(destination))
        self.assertFalse(destination.exists())

    def test_deleted_policy_is_detected_even_when_override_was_cleared(self):
        self.configure(1)
        self.configure(None)
        with closing(sqlite3.connect(self.f.store.path, autocommit=True)) as connection:
            connection.execute("DELETE FROM operator_task_capacity")
        self.refused("TASK_CAPACITY_CONSISTENCY_FAILURE", self.f.store.audit)

    def test_admission_snapshot_cannot_claim_a_different_policy_revision(self):
        self.configure(1)
        self.submit()
        # A local attacker can rehash the chain. Independent consistency checks
        # still reject this mismatch; none of this is external attestation.
        with closing(sqlite3.connect(self.f.store.path, autocommit=True)) as connection:
            connection.row_factory = sqlite3.Row
            previous = ZERO_HASH
            for event in connection.execute("SELECT * FROM audit ORDER BY seq").fetchall():
                detail = json.loads(event["details"])
                if event["action"] == "JOB_SUBMIT":
                    detail["operator_task_capacity"]["revision"] = 0
                payload = [event["seq"], event["at_ms"], event["actor_role"], event["actor_id"],
                           event["action"], event["resource_id"], detail, previous]
                fingerprint = hashlib.sha256(AUDIT_DOMAIN + canonical(payload).encode()).hexdigest()
                connection.execute("UPDATE audit SET details=?,previous_hash=?,hash=? WHERE seq=?",
                                   (canonical(detail), previous, fingerprint, event["seq"]))
                previous = fingerprint
        self.refused("TASK_CAPACITY_CONSISTENCY_FAILURE", self.f.store.audit)
