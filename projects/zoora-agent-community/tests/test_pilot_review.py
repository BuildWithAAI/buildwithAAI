"""Actual pinned TLS reads, retained report bytes and uncertain completion recovery."""

import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch
import uuid

from helpers import Fixture
from test_private_pilot import TLSCommunity
from model_fixture import ModelFixture
from zoora_community.client import Client
from zoora_community.job_worker import complete
from zoora_community.pilot_review import pilot_review
from zoora_community.pilot_session import pilot_session
from zoora_community.validation import Problem, canonical


class PilotReviewTests(unittest.TestCase):
    def setUp(self):
        self.f = Fixture(real_time=True)
        self.addCleanup(self.f.close)
        _, self.operator = self.f.operator()
        self.agent, self.token = self.f.agent(self.operator, "review_alpha")
        self.peer, self.peer_token = self.f.agent(self.operator, "review_beta")
        self.project = self.f.project(self.token)
        self.instance = self.f.store.call("GET", "/v1/status")[1]["instance_id"]
        self.credential = self.f.root / "agent.json"
        self.credential.write_text(canonical({**self.f.store.call("GET", "/v1/me", token=self.token)[1],
                                              "token": self.token}), encoding="utf-8")
        self.credential.chmod(0o600)
        self.folder = self.f.root / "session"
        self.reports = self.folder / "reports"
        self.out = self.f.root / "review.json"
        self.tls = TLSCommunity(self.f.store)
        self.addCleanup(self.tls.stop)
        self.trust = patch("zoora_community.client.ssl.create_default_context", return_value=self.tls.client_context)
        self.trust.start()
        self.addCleanup(self.trust.stop)
        self.model = ModelFixture().start()
        self.addCleanup(self.model.stop)

    def submit(self, *, project=None, token=None):
        return self.f.store.call("POST", "/v1/jobs", {"request_id": uuid.uuid4().hex,
            "title": "PRIVATE prior task", "prompt": "PRIVATE prompt: measure Zoora builds.",
            "project_id": project or self.project}, token or self.token)[1]["job"]

    def session(self):
        return pilot_session(self.credential, self.folder, community_origin=self.tls.origin,
            expected_instance=self.instance, expected_agent=self.agent, collaboration_project=self.project,
            model="synthetic-fixture", model_port=self.model.port)

    def completed(self):
        job = self.submit()
        self.session()
        return self.f.store.call("GET", "/v1/jobs/" + job["id"], token=self.token)[1]

    def review(self, *jobs, **overrides):
        options = dict(community_origin=self.tls.origin, expected_instance=self.instance,
            expected_agent=self.agent, collaboration_project=self.project, job_ids=[job["id"] for job in jobs])
        options.update(overrides)
        return pilot_review(self.credential, self.reports, self.out, **options)

    def saved(self):
        return json.loads(self.out.read_bytes())

    def rejected(self, code, action):
        with self.assertRaises(Problem) as caught:
            action()
        self.assertEqual(caught.exception.code, code)

    def test_actual_cli_confirms_hashes_with_only_gets_and_unchanged_inputs_and_database(self):
        job = self.completed()
        paths = [self.credential, self.folder / "session.jsonl", self.folder / "preflight.json", *self.reports.glob("*.json")]
        before = {path: path.read_bytes() for path in paths}
        database = self.f.store.path.read_bytes()
        requests = list(self.model.requests)
        self.tls.exchanges.clear()
        child = subprocess.run([sys.executable, "-bb", "-X", "dev", "-W", "error", "-m", "zoora_community",
            "pilot-review", "--community-origin", self.tls.origin, "--expected-instance", self.instance,
            "--expected-agent", self.agent, "--credential-file", str(self.credential), "--collaboration-project", self.project,
            "--reports-dir", str(self.reports), "--job-id", job["id"], "--out", str(self.out)],
            env={**os.environ, "SSL_CERT_FILE": str(Path(__file__).parent / "fixtures/bridge-localhost-cert.pem")},
            capture_output=True, text=True, timeout=45)
        self.assertEqual(child.returncode, 0, child.stderr)
        result, saved = json.loads(child.stdout), self.saved()
        self.assertEqual(result["state"], "SELECTED_TASKS_CONFIRMED")
        self.assertEqual(result["jobs_confirmed"], 1)
        self.assertEqual(result["report_sha256"], hashlib.sha256(self.out.read_bytes()).hexdigest())
        self.assertEqual(saved["jobs"][0]["report_sha256"], job["report_sha256"])
        self.assertEqual(saved["jobs"][0]["server_declared_artifact_id"], job["artifact_id"])
        self.assertTrue(self.tls.exchanges)
        self.assertTrue(all(method == "GET" for method, _, _ in self.tls.exchanges))
        self.assertTrue(all("expected_instance=" + self.instance in path for _, path, _ in self.tls.exchanges))
        self.assertTrue(all("expected_agent=" + self.agent in path for _, path, auth in self.tls.exchanges if auth))
        self.assertEqual(before, {path: path.read_bytes() for path in paths})
        self.assertEqual(database, self.f.store.path.read_bytes())
        self.assertEqual(requests, self.model.requests)
        self.assertFalse(saved["all_historical_tasks_checked"])
        self.assertEqual(saved["task_quality"], "UNVERIFIED")
        public = self.out.read_text() + child.stdout + child.stderr
        for secret in (self.token, self.peer_token, "jr1_", "PRIVATE", "SYNTHETIC fixture output", str(self.credential), str(self.reports)):
            self.assertNotIn(secret, public)
        if os.name == "posix":
            self.assertEqual(self.out.stat().st_mode & 0o077, 0)
        self.f.store.audit()

    def test_lost_completion_responses_are_reconciled_without_mutation_or_second_inference(self):
        job = self.submit()

        def lost(client, token, claimed, payload):
            complete(client, token, claimed, payload)
            raise OSError("PRIVATE response lost after commit")

        with patch("zoora_community.job_worker.complete", side_effect=lost):
            self.rejected("PILOT_SESSION_ATTENTION_REQUIRED", self.session)
        self.assertEqual(json.loads((self.folder / "session.jsonl").read_bytes().splitlines()[-2])["state"], "UNCONFIRMED")
        requests, database = list(self.model.requests), self.f.store.path.read_bytes()
        self.tls.exchanges.clear()
        self.assertEqual(self.review(job)["state"], "SELECTED_TASKS_CONFIRMED")
        self.assertEqual(requests, self.model.requests)
        self.assertEqual(database, self.f.store.path.read_bytes())
        self.assertTrue(all(method == "GET" for method, _, _ in self.tls.exchanges))

    def test_one_completed_task_cannot_hide_a_selected_queued_task(self):
        done = self.completed()
        queued = self.submit()
        result = self.review(done, queued)
        self.assertEqual(result["state"], "ATTENTION_REQUIRED")
        self.assertEqual(result["jobs_checked"], 2)
        self.assertEqual(result["jobs_confirmed"], 1)
        self.assertEqual(self.saved()["jobs"][1]["completion_check"], "NOT_SUCCEEDED")

    def test_running_claim_is_observed_without_waiting_or_retiring_it(self):
        job = self.submit()
        self.reports.mkdir(parents=True, mode=0o700)
        claimed = self.f.store.call("POST", "/v1/jobs/claim", {"max_steps": 4, "timeout_seconds": 60}, self.token)[1]
        before = self.f.store.path.read_bytes()
        result = self.review(job)
        self.assertEqual(result["state"], "ATTENTION_REQUIRED")
        self.assertEqual(self.saved()["jobs"][0]["server_state"], "RUNNING")
        self.assertEqual(self.saved()["jobs"][0]["attempt_id"], claimed["job"]["attempt_id"])
        self.assertEqual(before, self.f.store.path.read_bytes())

    def test_effectively_expired_lease_is_not_reported_as_completed(self):
        job = self.submit()
        self.reports.mkdir(parents=True, mode=0o700)
        claimed = self.f.store.call("POST", "/v1/jobs/claim", {"max_steps": 4, "timeout_seconds": 60}, self.token)[1]["job"]
        self.f.store.clock = lambda: claimed["lease_expires_ms"] + 1
        before = self.f.store.path.read_bytes()
        self.assertEqual(self.review(job)["state"], "ATTENTION_REQUIRED")
        self.assertEqual(self.saved()["jobs"][0]["server_state"], "INTERRUPTED")
        self.assertEqual(before, self.f.store.path.read_bytes())

    def test_stopped_task_is_not_reported_as_completed(self):
        job = self.submit()
        self.reports.mkdir(parents=True, mode=0o700)
        self.f.store.call("POST", "/v1/jobs/" + job["id"] + "/stop", {}, self.token)
        self.assertEqual(self.review(job)["state"], "ATTENTION_REQUIRED")
        self.assertEqual(self.saved()["jobs"][0]["server_state"], "CANCELLED")

    def test_failed_task_with_a_retained_report_is_not_confirmed(self):
        job = self.submit()
        self.model.actions = [{"action": "not_an_allowed_tool", "arguments": {}}]
        self.rejected("PILOT_SESSION_ATTENTION_REQUIRED", self.session)
        self.assertTrue(list(self.reports.glob("*.json")))
        self.assertEqual(self.review(job)["state"], "ATTENTION_REQUIRED")
        self.assertEqual(self.saved()["jobs"][0]["server_state"], "FAILED")

    def test_matching_digest_cannot_substitute_an_unpinned_report(self):
        job = self.submit()
        claimed = self.f.store.call("POST", "/v1/jobs/claim", {"max_steps": 4, "timeout_seconds": 60}, self.token)[1]
        current = claimed["job"]
        self.reports.mkdir(parents=True, mode=0o700)
        raw = (canonical({"protocol": "ZOORA_AE009_RUN_V1", "state": "AVAILABLE",
            "job": {"job_id": job["id"], "attempt_id": current["attempt_id"]},
            "agent_id": self.agent, "credential_id": current["worker_credential_id"],
            "task": {"prompt": current["prompt"]}, "max_steps": 4, "timeout_seconds": 60,
            "steps": [{"classification": "SYNTHETIC_DECLARATION"}],
            "connection_binding": {"enforced": False, "expected_instance_id": None, "expected_agent_id": None}}) + "\n").encode()
        path = self.reports / (job["id"] + "-" + current["attempt_id"] + ".json")
        path.write_bytes(raw)
        path.chmod(0o600)
        self.f.store.call("POST", "/v1/jobs/" + job["id"] + "/complete",
            {"attempt_id": current["attempt_id"], "claim_token": claimed["claim_token"], "state": "SUCCEEDED",
             "report_sha256": hashlib.sha256(raw).hexdigest(), "report_bytes": len(raw), "steps": 1, "error_code": None}, self.token)
        self.assertEqual(self.review(job)["state"], "ATTENTION_REQUIRED")
        self.assertEqual(self.saved()["jobs"][0]["completion_check"], "LOCAL_REPORT_BINDING_MISMATCH")

    def test_report_symlink_is_refused_on_posix(self):
        job = self.completed()
        if os.name == "posix":
            path = next(self.reports.glob("*.json"))
            target = self.f.root / "private-report.json"
            path.rename(target)
            path.symlink_to(target)
            self.assertEqual(self.review(job)["state"], "ATTENTION_REQUIRED")
            self.assertEqual(self.saved()["jobs"][0]["completion_check"], "LOCAL_REPORT_UNAVAILABLE")
        else:
            self.assertEqual(self.review(job)["state"], "SELECTED_TASKS_CONFIRMED")

    def test_modified_report_bytes_do_not_confirm_success(self):
        job = self.completed()
        path = next(self.reports.glob("*.json"))
        path.write_bytes(path.read_bytes() + b"\n")
        self.assertEqual(self.review(job)["state"], "ATTENTION_REQUIRED")
        self.assertEqual(self.saved()["jobs"][0]["completion_check"], "LOCAL_REPORT_DIGEST_MISMATCH")

    def test_missing_private_report_does_not_confirm_server_success(self):
        job = self.completed()
        next(self.reports.glob("*.json")).unlink()
        self.assertEqual(self.review(job)["state"], "ATTENTION_REQUIRED")
        self.assertEqual(self.saved()["jobs"][0]["completion_check"], "LOCAL_REPORT_UNAVAILABLE")

    def test_other_project_task_is_refused(self):
        job = self.completed()
        other = self.f.project(self.token)
        self.assertEqual(self.review(job, collaboration_project=other)["state"], "BLOCKED")
        self.assertEqual(self.saved()["error_code"], "PILOT_REVIEW_SCOPE_MISMATCH")

    def test_other_agents_task_is_refused(self):
        own = self.completed()
        other = self.f.project(self.peer_token)
        job = self.submit(project=other, token=self.peer_token)
        self.assertEqual(self.review(own, job)["state"], "BLOCKED")
        self.assertEqual(self.saved()["error_code"], "FORBIDDEN")

    def test_wrong_instance_is_refused_before_bearer_transmission(self):
        job = self.completed()
        self.tls.exchanges.clear()
        self.assertEqual(self.review(job, expected_instance="f" * 32)["state"], "BLOCKED")
        self.assertFalse(any(auth for _, _, auth in self.tls.exchanges))
        self.assertEqual(self.saved()["error_code"], "COMMUNITY_INSTANCE_MISMATCH")

    def test_untrusted_tls_is_refused_before_authentication(self):
        job = self.completed()
        self.trust.stop()
        self.tls.exchanges.clear()
        self.assertEqual(self.review(job)["state"], "BLOCKED")
        self.assertFalse(any(auth for _, _, auth in self.tls.exchanges))

    def test_redirect_is_refused_before_authentication(self):
        job = self.completed()
        self.tls.redirect = True
        self.tls.exchanges.clear()
        self.assertEqual(self.review(job)["state"], "BLOCKED")
        self.assertEqual(self.saved()["error_code"], "COMMUNITY_REDIRECT_REJECTED")
        self.assertFalse(any(auth for _, _, auth in self.tls.exchanges))

    def test_existing_output_and_invalid_selection_fail_before_network(self):
        job = self.completed()
        with patch.object(Client, "request", side_effect=AssertionError("network before local validation")):
            for ids in ([], [job["id"], job["id"]], ["f" * 32] * 17, ["../private"], "f" * 32):
                with self.subTest(ids=ids):
                    with self.assertRaises(Problem):
                        self.review(job, job_ids=ids)
            self.out.write_bytes(b"private existing result")
            with self.assertRaises(FileExistsError):
                self.review(job)
        self.assertEqual(self.out.read_bytes(), b"private existing result")

    def test_unknown_server_errors_are_redacted(self):
        job = self.completed()
        with patch.object(Client, "request", side_effect=Problem(502, "PRIVATE_" + self.token)):
            self.assertEqual(self.review(job)["state"], "BLOCKED")
        self.assertEqual(self.saved()["error_code"], "PILOT_REVIEW_REQUEST_FAILED")
        self.assertNotIn(self.token, self.out.read_text())

    def test_malformed_server_attempt_cannot_control_a_file_path_or_public_output(self):
        job = self.completed()
        original = Client.request

        def changed(client, method, path, *args, **kwargs):
            status, result = original(client, method, path, *args, **kwargs)
            if path == "/v1/jobs/" + job["id"]:
                result["attempt_id"] = "../PRIVATE_" + self.token
            return status, result

        with patch.object(Client, "request", changed):
            self.assertEqual(self.review(job)["state"], "BLOCKED")
        self.assertNotIn(self.token, self.out.read_text())

    def test_changed_final_credential_cannot_leave_a_confirmed_review(self):
        job = self.completed()
        original, count = Client.request, 0

        def changed(client, method, path, *args, **kwargs):
            nonlocal count
            status, result = original(client, method, path, *args, **kwargs)
            if path == "/v1/me":
                count += 1
                if count == 2:
                    result["expires_at_ms"] += 1
            return status, result

        with patch.object(Client, "request", changed):
            self.assertEqual(self.review(job)["state"], "BLOCKED")
        self.assertEqual(self.saved()["error_code"], "PILOT_REVIEW_AUTH_CHANGED")

    def test_record_fsync_failure_never_returns_a_success_result(self):
        job = self.completed()
        with patch("zoora_community.pilot_review.os.fsync", side_effect=OSError("PRIVATE disk failure")):
            with self.assertRaises(OSError):
                self.review(job)

    def test_private_report_permissions_are_checked_on_posix(self):
        job = self.completed()
        path = next(self.reports.glob("*.json"))
        if os.name == "posix":
            path.chmod(0o644)
            self.assertEqual(self.review(job)["state"], "ATTENTION_REQUIRED")
            self.assertEqual(self.saved()["jobs"][0]["completion_check"], "LOCAL_REPORT_UNAVAILABLE")
        else:
            self.assertEqual(self.review(job)["state"], "SELECTED_TASKS_CONFIRMED")
