"""Authorization, crash/stop recovery, idempotence and atomic publication in real SQLite."""

from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
import json
import sqlite3
import unittest
from unittest.mock import patch
import uuid

from helpers import Fixture
from zoora_community.jobs import QUEUE_TTL_MS
from zoora_community.recovery import restore_backup
from zoora_community.store import LIMITS, Store
from zoora_community.validation import Problem, canonical


class JobTests(unittest.TestCase):
    def setUp(self):
        self.f = Fixture()
        self.addCleanup(self.f.close)
        self.operator_id, self.operator = self.f.operator()
        self.agent_id, self.agent = self.f.agent(self.operator)
        self.project = self.f.project(self.agent)
        self.body = {"request_id": uuid.uuid4().hex, "title": "Private task", "prompt": "Private prompt: measure text."}

    def submit(self, body=None, token=None):
        return self.f.store.call("POST", "/v1/jobs", self.body if body is None else body, token or self.agent)[1]

    def claim(self, token=None, **limits):
        return self.f.store.call("POST", "/v1/jobs/claim", {"max_steps": 4, "timeout_seconds": 60, **limits}, token or self.agent)[1]

    def read(self, record_id, token=None):
        return self.f.store.call("GET", "/v1/jobs/" + record_id, token=token or self.agent)[1]

    def stop(self, record_id, token=None):
        return self.f.store.call("POST", "/v1/jobs/" + record_id + "/stop", {}, token or self.agent)[1]

    def completion(self, claim, **changes):
        return {"attempt_id": claim["job"]["attempt_id"], "claim_token": claim["claim_token"],
                "state": "SUCCEEDED", "report_sha256": "a" * 64, "report_bytes": 200,
                "steps": 2, "error_code": None, **changes}

    def finish(self, claim, body=None, token=None):
        return self.f.store.call("POST", "/v1/jobs/" + claim["job"]["id"] + "/complete",
                                 self.completion(claim) if body is None else body, token or self.agent)[1]

    def refused(self, code, callback):
        with self.assertRaises(Problem) as denied:
            callback()
        self.assertEqual(denied.exception.code, code)

    def test_private_reads_and_ownership_and_owner_stop(self):
        job = self.submit()["job"]
        _, other_operator = self.f.operator("other_operator")
        _, other_agent = self.f.agent(other_operator, "other_agent")
        self.refused("UNAUTHORIZED", lambda: self.f.store.call("GET", "/v1/jobs"))
        for token in (other_operator, other_agent):
            self.refused("FORBIDDEN", lambda token=token: self.read(job["id"], token))
            self.refused("FORBIDDEN", lambda token=token: self.stop(job["id"], token))
            self.assertEqual(self.f.store.call("GET", "/v1/jobs", token=token)[1]["items"], [])
        for token in (self.agent, self.operator, self.f.owner):
            items = self.f.store.call("GET", "/v1/jobs", token=token)[1]["items"]
            self.assertEqual(len(items), 1)
            self.assertNotIn("prompt", items[0])
            self.assertEqual(self.read(job["id"], token)["prompt"], self.body["prompt"])
        self.assertEqual(self.stop(job["id"], self.f.owner)["state"], "CANCELLED")
        audit = canonical(self.f.store.call("GET", "/v1/audit", token=self.f.owner)[1])
        self.assertNotIn(self.body["prompt"], audit)
        self.f.store.audit()

    def test_owner_operator_cannot_submit_or_claim_as_agent(self):
        for token in (self.operator, self.f.owner):
            self.refused("FORBIDDEN", lambda token=token: self.submit(token=token))
            self.refused("FORBIDDEN", lambda token=token: self.claim(token))

    def test_concurrent_identical_submissions_create_one_job_and_changed_payload_conflicts(self):
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(lambda _: self.submit(), range(8)))
        self.assertEqual(len({result["job"]["id"] for result in results}), 1)
        self.assertEqual(sum(not result["replayed"] for result in results), 1)
        self.refused("JOB_REQUEST_CONFLICT", lambda: self.submit({**self.body, "prompt": "Changed request"}))
        self.f.store.audit()

    def test_invalid_payloads_cannot_claim_resources(self):
        cases = [("max_steps", True, "INVALID_RUN_LIMIT"), ("max_steps", 7, "INVALID_RUN_LIMIT"),
                 ("timeout_seconds", 0, "INVALID_RUN_LIMIT"), ("timeout_seconds", 121, "INVALID_RUN_LIMIT"),
                 ("prompt", "x" * 4097, "INVALID_TEXT"), ("prompt", "", "INVALID_TEXT"),
                 ("request_id", "http://remote.invalid", "INVALID_ID"), ("project_id", "../file", "INVALID_ID"),
                 ("title", "\u0000", "INVALID_TEXT"), ("wallet", "ignored", "INVALID_FIELDS")]
        for key, value, code in cases:
            with self.subTest(key=key, value=str(value)[:20]):
                self.refused(code, lambda key=key, value=value: self.submit({**self.body, key: value}))
        self.assertEqual(self.f.store.call("GET", "/v1/jobs", token=self.agent)[1]["items"], [])

    def test_project_membership_required_at_submission(self):
        _, another = self.f.agent(self.operator, "other_agent")
        project = self.f.project(another)
        self.refused("PROJECT_MEMBERSHIP_REQUIRED", lambda: self.submit({**self.body, "project_id": project}))

    def test_concurrent_claims_one_attempt_global_and_host_clamps_budget(self):
        job = self.submit({**self.body, "max_steps": 3, "timeout_seconds": 50})["job"]
        self.submit({**self.body, "request_id": uuid.uuid4().hex})
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(lambda _: self.claim(max_steps=2, timeout_seconds=40), range(8)))
        claims = [result for result in results if result["job"]]
        self.assertEqual(len(claims), 1)
        claimed = claims[0]
        self.assertEqual(claimed["job"]["id"], job["id"])
        self.assertEqual((claimed["job"]["run_max_steps"], claimed["job"]["run_timeout_seconds"]), (2, 40))
        _, other = self.f.agent(self.operator, "other_agent")
        self.submit({**self.body, "request_id": uuid.uuid4().hex}, other)
        self.assertEqual(self.claim(other)["reason"], "WORKER_BUSY")
        for token in (claimed["claim_token"], self.agent):
            self.assertNotIn(token.encode(), self.f.store.path.read_bytes())
            self.assertNotIn(token, canonical(self.read(job["id"])))
            self.assertNotIn(token, canonical(self.f.store.call("GET", "/v1/audit", token=self.f.owner)[1]))
        self.f.store.audit()

    def test_expired_queue_retires_without_inference_or_automatic_retry(self):
        job = self.submit()["job"]
        self.f.at += QUEUE_TTL_MS
        self.assertEqual(self.read(job["id"])["state"], "EXPIRED")
        self.assertIsNone(self.claim()["job"])
        self.assertEqual(self.read(job["id"])["recorded_state"], "EXPIRED")
        self.assertTrue(self.submit()["replayed"])
        self.f.store.audit()

    def test_crash_lease_expires_and_restarted_store_does_not_requeue(self):
        job = self.submit()["job"]
        claimed = self.claim()
        self.f.at = claimed["job"]["lease_expires_ms"]
        self.f.store = Store(self.f.state, clock=lambda: self.f.at)
        self.assertEqual(self.read(job["id"])["state"], "INTERRUPTED")
        self.assertIsNone(self.claim()["job"])
        self.refused("JOB_NOT_RUNNING", lambda: self.finish(claimed))
        self.assertTrue(self.submit()["replayed"])
        self.f.store.audit()

    def test_queued_stop_is_idempotent_and_never_claimed(self):
        job = self.submit()["job"]
        self.assertEqual(self.stop(job["id"], self.operator)["state"], "CANCELLED")
        audit = self.f.store.audit()
        self.assertEqual(self.stop(job["id"])["state"], "CANCELLED")
        self.assertEqual(self.f.store.audit(), audit)
        self.assertIsNone(self.claim()["job"])

    def test_stop_wins_completion_race_and_blocks_publication(self):
        self.submit({**self.body, "project_id": self.project})
        claimed = self.claim()
        self.assertTrue(self.stop(claimed["job"]["id"])["stop_requested"])
        result = self.finish(claimed)["job"]
        self.assertEqual(result["state"], "CANCELLED")
        self.assertEqual(result["error_code"], "JOB_STOPPED")
        self.assertIsNone(result["artifact_id"])
        self.assertEqual(self.f.store.call("GET", "/v1/projects/" + self.project + "/artifacts")[1]["items"], [])
        self.assertTrue(self.finish(claimed)["replayed"])
        self.f.store.audit()

    def test_completion_authentication_retry_and_altered_declaration(self):
        self.submit({**self.body, "project_id": self.project})
        claimed = self.claim()
        self.refused("JOB_CLAIM_MISMATCH", lambda: self.finish(claimed, self.completion(claimed, claim_token="jr1_" + "x" * 43)))
        self.refused("FORBIDDEN", lambda: self.finish(claimed, token=self.operator))
        first = self.finish(claimed)
        self.assertEqual(first["job"]["state"], "SUCCEEDED")
        audit = self.f.store.audit()
        retry = self.finish(claimed)
        self.assertTrue(retry["replayed"])
        self.assertEqual(first["job"], retry["job"])
        self.assertEqual(self.f.store.audit(), audit)
        self.refused("JOB_COMPLETION_CONFLICT", lambda: self.finish(claimed, self.completion(claimed, report_sha256="b" * 64)))
        artifacts = self.f.store.call("GET", "/v1/projects/" + self.project + "/artifacts")[1]["items"]
        self.assertEqual(len(artifacts), 1)
        self.assertEqual(artifacts[0]["author_id"], self.agent_id)
        self.assertEqual(artifacts[0]["digest"], first["job"]["report_sha256"])

    def test_artifact_and_job_completion_roll_back_together_on_audit_failure(self):
        self.submit({**self.body, "project_id": self.project})
        claimed = self.claim()
        original = self.f.store._event

        def fail(connection, principal, action, resource, details, at):
            if action == "JOB_COMPLETE":
                raise RuntimeError("injected audit failure")
            return original(connection, principal, action, resource, details, at)

        before = self.f.store.audit()
        with patch.object(self.f.store, "_event", side_effect=fail), self.assertRaises(RuntimeError):
            self.finish(claimed)
        self.assertEqual(self.read(claimed["job"]["id"])["state"], "RUNNING")
        self.assertEqual(self.f.store.audit(), before)
        self.assertEqual(self.f.store.call("GET", "/v1/projects/" + self.project + "/artifacts")[1]["items"], [])
        self.assertEqual(self.finish(claimed)["job"]["state"], "SUCCEEDED")

    def test_bad_completions_cannot_publish_or_exceed_claim(self):
        self.submit()
        claimed = self.claim(max_steps=2)
        for change in ({"steps": True}, {"steps": 3}, {"steps": 0}, {"state": "QUEUED"}, {"state": []},
                       {"report_sha256": None, "report_bytes": None}, {"report_bytes": 131073},
                       {"error_code": "MODEL_WARNING"}):
            with self.subTest(change=change):
                self.refused("INVALID_JOB_COMPLETION", lambda change=change: self.finish(claimed, self.completion(claimed, **change)))
        failed = self.completion(claimed, state="FAILED", report_sha256=None, report_bytes=None, steps=0, error_code="MODEL_UNAVAILABLE")
        self.assertEqual(self.finish(claimed, failed)["job"]["state"], "FAILED")
        self.f.store.audit()

    def test_credential_rotation_cancels_queued_and_interrupts_claimed_jobs(self):
        running_id = self.submit()["job"]["id"]
        claimed = self.claim()
        queued_id = self.submit({**self.body, "request_id": uuid.uuid4().hex})["job"]["id"]
        fresh = self.f.store.call("POST", "/v1/credentials/rotate", {}, self.agent)[1]["credential"]["token"]
        self.refused("UNAUTHORIZED", lambda: self.finish(claimed))
        self.assertEqual(self.read(running_id, self.operator)["state"], "INTERRUPTED")
        self.assertEqual(self.read(queued_id, fresh)["state"], "CANCELLED")
        self.assertIsNone(self.claim(fresh)["job"])
        self.f.store.audit()

    def test_capacity_and_queue_quota_retries_still_return_original(self):
        original = self.submit()
        for _ in range(3):
            self.submit({**self.body, "request_id": uuid.uuid4().hex})
        self.refused("JOB_QUEUE_LIMIT", lambda: self.submit({**self.body, "request_id": uuid.uuid4().hex}))
        self.assertEqual(self.submit()["job"]["id"], original["job"]["id"])
        for item in self.f.store.call("GET", "/v1/jobs", token=self.agent)[1]["items"]:
            self.stop(item["id"])
        with patch.dict(LIMITS, jobs=4):
            self.refused("STORAGE_LIMIT", lambda: self.submit({**self.body, "request_id": uuid.uuid4().hex}))

    def test_backup_restore_preserves_attempt_but_recovery_denies_old_credentials(self):
        self.submit()
        claimed = self.claim()
        backup = self.f.root / "backup.sqlite3"
        self.f.store.backup(backup)
        restored = self.f.root / "restored"
        restore_backup(backup, restored)
        self.f.store = Store(restored, clock=lambda: self.f.at)
        self.assertEqual(self.read(claimed["job"]["id"])["attempt_id"], claimed["job"]["attempt_id"])
        recovered = self.f.root / "recovered.json"
        self.f.store.recover_owner(recovered, invalidate_all=True)
        owner = json.loads(recovered.read_text())["token"]
        self.assertEqual(self.read(claimed["job"]["id"], owner)["state"], "INTERRUPTED")
        self.refused("UNAUTHORIZED", lambda: self.finish(claimed))
        self.f.store.audit()

    def test_audit_rejects_tampered_prompt_and_completed_report_metadata(self):
        job = self.submit()["job"]
        claimed = self.claim()
        self.finish(claimed)
        with closing(sqlite3.connect(self.f.store.path)) as connection:
            connection.execute("UPDATE jobs SET prompt='Altered private prompt' WHERE id=?", (job["id"],))
            connection.commit()
        self.refused("JOB_CONSISTENCY_FAILURE", self.f.store.audit)
        with closing(sqlite3.connect(self.f.store.path)) as connection:
            connection.execute("UPDATE jobs SET prompt=?,report_sha256=? WHERE id=?", (self.body["prompt"], "b" * 64, job["id"]))
            connection.commit()
        self.refused("JOB_CONSISTENCY_FAILURE", self.f.store.audit)
