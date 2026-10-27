"""Supervised CLI sessions over real TLS/Waitress/SQLite; models are SYNTHETIC."""

import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import time
import unittest
from unittest.mock import patch
import uuid

from helpers import Fixture
from test_private_pilot import TLSCommunity
from model_fixture import ModelFixture
from zoora_community.client import Client
from zoora_community.pilot_session import SessionJournal, pilot_session
from zoora_community.validation import Problem, canonical


class PilotSessionTests(unittest.TestCase):
    def setUp(self):
        self.f = Fixture(real_time=True)
        self.addCleanup(self.f.close)
        _, self.operator = self.f.operator()
        self.agent, self.token = self.f.agent(self.operator, "session_alpha")
        self.peer, self.peer_token = self.f.agent(self.operator, "session_beta")
        self.project = self.f.project(self.token)
        self.instance = self.f.store.call("GET", "/v1/status")[1]["instance_id"]
        self.credential = self.save_credential(self.token, "alpha.json")
        self.expiry = self.f.store.call("GET", "/v1/me", token=self.token)[1]["expires_at_ms"]
        self.folder = self.f.root / "session-001"
        self.tls = TLSCommunity(self.f.store)
        self.addCleanup(self.tls.stop)
        self.trust = patch("zoora_community.client.ssl.create_default_context", return_value=self.tls.client_context)
        self.trust.start()
        self.addCleanup(self.trust.stop)
        self.model = ModelFixture().start()
        self.addCleanup(self.model.stop)

    def save_credential(self, token, name):
        metadata = self.f.store.call("GET", "/v1/me", token=token)[1]
        path = self.f.root / name
        path.write_text(canonical({**metadata, "token": token}), encoding="utf-8")
        path.chmod(0o600)
        return path

    def submit(self, *, project=None, token=None, **extra):
        return self.f.store.call("POST", "/v1/jobs", {"request_id": uuid.uuid4().hex,
            "title": "PRIVATE session task title", "prompt": "PRIVATE session prompt; measure Zoora builds.",
            "project_id": project or self.project, **extra}, token or self.token)[1]["job"]

    def check(self, **overrides):
        options = dict(community_origin=self.tls.origin, expected_instance=self.instance, expected_agent=self.agent,
                       collaboration_project=self.project, model="synthetic-fixture", model_port=self.model.port)
        options.update(overrides)
        return pilot_session(self.credential, self.folder, **options)

    def records(self):
        return [json.loads(line) for line in (self.folder / "session.jsonl").read_bytes().splitlines()]

    def refused(self, code, action):
        with self.assertRaises(Problem) as denied:
            action()
        self.assertEqual(denied.exception.code, code)

    def command(self, *, credential=None, folder=None, agent=None, model=None):
        return [sys.executable, "-bb", "-X", "dev", "-W", "error", "-m", "zoora_community", "pilot-session",
            "--community-origin", self.tls.origin, "--expected-instance", self.instance,
            "--expected-agent", agent or self.agent, "--credential-file", str(credential or self.credential),
            "--collaboration-project", self.project, "--model", "synthetic-fixture", "--model-port", str((model or self.model).port),
            "--session-dir", str(folder or self.folder), "--timeout", "90"]

    def environment(self):
        return {**os.environ, "SSL_CERT_FILE": str(Path(__file__).parent / "fixtures/bridge-localhost-cert.pem")}

    def failure_evidence(self, folder):
        """Retain fixed failure context in CI, never private prompts or outputs."""
        result = {"phases": [], "reports": []}
        try:
            rows = [json.loads(line) for line in (folder / "session.jsonl").read_bytes().splitlines()]
            result["phases"] = [{key: row[key] for key in ("phase", "state", "stage", "error_code") if key in row} for row in rows]
        except (OSError, ValueError):
            result["journal_unreadable"] = True
        for path in (folder / "reports").glob("*.json"):
            try:
                report = json.loads(path.read_bytes())
                result["reports"].append({"state": report["state"], "error": report.get("error"),
                                          "steps": len(report["steps"]), "last_model_response": report.get("last_model_response")})
            except (OSError, ValueError, KeyError, TypeError):
                result["report_unreadable"] = True
        return canonical(result)

    def test_actual_cli_success_keeps_ordered_redacted_journal_and_bound_report(self):
        job = self.submit()
        completed = subprocess.run(self.command(), env=self.environment(), capture_output=True, text=True, timeout=30)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        result = json.loads(completed.stdout)
        self.assertEqual(result["jobs_processed"], 1)
        records = self.records()
        self.assertEqual([row["phase"] for row in records], ["SESSION_STARTED", "PREFLIGHT_PASSED", "CLAIM_STARTED",
            "CLAIMED", "REPORT_SAVED", "COMPLETION_STARTED", "JOB_RESULT", "SESSION_FINISHED"])
        self.assertEqual([row["sequence"] for row in records], list(range(1, 9)))
        self.assertEqual(records[-1]["state"], "COMPLETED")
        raw = (self.folder / "session.jsonl").read_bytes()
        self.assertEqual(hashlib.sha256(raw).hexdigest(), result["journal_sha256"])
        self.assertEqual(hashlib.sha256((self.folder / "preflight.json").read_bytes()).hexdigest(), result["preflight_sha256"])
        report_path = next((self.folder / "reports").glob("*.json"))
        self.assertEqual(hashlib.sha256(report_path.read_bytes()).hexdigest(), records[4]["report_sha256"])
        saved = self.f.store.call("GET", "/v1/jobs/" + job["id"], token=self.token)[1]
        self.assertEqual(saved["state"], "SUCCEEDED")
        self.assertEqual(saved["artifact_id"], records[6]["artifact_id"])
        self.assertEqual(json.loads(report_path.read_bytes())["connection_binding"]["expected_instance_id"], self.instance)
        public = raw.decode() + completed.stdout + completed.stderr
        for secret in (self.token, self.peer_token, self.operator, "jr1_", "PRIVATE session", "SYNTHETIC fixture output", str(self.credential)):
            self.assertNotIn(secret, public)
        if os.name == "posix":
            self.assertEqual(self.folder.stat().st_mode & 0o077, 0)
            for path in (self.folder / "session.jsonl", self.folder / "preflight.json", report_path):
                self.assertEqual(path.stat().st_mode & 0o077, 0)
        self.f.store.audit()

    def test_two_cli_hosts_can_hold_separate_attempts_and_post_attributed_notes(self):
        self.f.store.call("POST", "/v1/projects/" + self.project + "/members", {"agent_id": self.peer}, self.token)
        self.submit(timeout_seconds=90)
        self.submit(token=self.peer_token, timeout_seconds=90)
        peer_file = self.save_credential(self.peer_token, "beta.json")
        gate, arrived = threading.Event(), [threading.Event(), threading.Event()]
        models = []
        for index in range(2):
            model = ModelFixture(actions=[{"action": "project_discussion", "arguments": {}},
                {"action": "project_note", "arguments": {"body": "SYNTHETIC peer note " + str(index)}},
                {"action": "finish", "arguments": {"output": "SYNTHETIC supervised result"}}])
            original_handler, event = model.server.RequestHandlerClass, arrived[index]

            class Gated(original_handler):
                def do_POST(self, event=event):
                    if self.path == "/api/chat":
                        event.set()
                        gate.wait(55)
                    super().do_POST()

            model.server.RequestHandlerClass = Gated
            model.start()
            self.addCleanup(model.stop)
            models.append(model)
        folders = [self.folder, self.f.root / "beta-session"]
        commands = [self.command(model=models[0]), self.command(model=models[1], credential=peer_file, folder=folders[1], agent=self.peer)]
        children = []
        try:
            for command in commands:
                children.append(subprocess.Popen(command, env=self.environment(), stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True))
            arrival_deadline = time.monotonic() + 45
            self.assertTrue(all(event.wait(max(0, arrival_deadline - time.monotonic())) for event in arrived))
            jobs = self.f.store.call("GET", "/v1/jobs", token=self.operator)[1]["items"]
            self.assertEqual({job["agent_id"] for job in jobs if job["state"] == "RUNNING"}, {self.agent, self.peer})
            gate.set()
            for child, folder in zip(children, folders, strict=True):
                stdout, stderr = child.communicate(timeout=40)
                self.assertEqual(child.returncode, 0, stderr + "\n" + self.failure_evidence(folder))
                self.assertEqual(json.loads(stdout)["jobs_processed"], 1)
            for folder in folders:
                rows = [json.loads(line) for line in (folder / "session.jsonl").read_bytes().splitlines()]
                self.assertEqual(rows[-1]["state"], "COMPLETED")
            notes = self.f.store.call("GET", "/v1/projects/" + self.project + "/discussion", token=self.token)[1]["items"]
            self.assertEqual({note["author_id"] for note in notes}, {self.agent, self.peer})
            self.f.store.audit()
        finally:
            gate.set()
            for child in children:
                if child.poll() is None:
                    child.kill()
                child.communicate(timeout=10)

    def test_empty_selected_queue_finishes_without_inference(self):
        result = self.check(wait_seconds=1)
        self.assertEqual(result["jobs_processed"], 0)
        self.assertEqual(self.records()[-1]["outcome"], "NO_TASKS_AVAILABLE")
        self.assertEqual([path for path, _ in self.model.requests], ["/api/show"])
        self.assertEqual(sum(row["phase"] == "CLAIM_STARTED" for row in self.records()), 1)
        self.assertFalse(list((self.folder / "reports").glob("*.json")))

    def test_project_filter_skips_an_older_unrelated_task(self):
        other = self.f.project(self.token)
        unrelated = self.submit(project=other)
        selected = self.submit()
        self.check()
        self.assertEqual(self.f.store.call("GET", "/v1/jobs/" + unrelated["id"], token=self.token)[1]["state"], "QUEUED")
        self.assertEqual(self.f.store.call("GET", "/v1/jobs/" + selected["id"], token=self.token)[1]["state"], "SUCCEEDED")
        claimed = next(row for row in self.records() if row["phase"] == "CLAIMED")
        self.assertEqual(claimed["project_id"], self.project)
        self.assertEqual(claimed["job_id"], selected["id"])
        self.f.store.audit()

    def test_unrelated_queue_is_not_claimed_when_selected_project_is_empty(self):
        other = self.f.project(self.token)
        job = self.submit(project=other)
        self.assertEqual(self.check()["jobs_processed"], 0)
        self.assertEqual(self.f.store.call("GET", "/v1/jobs/" + job["id"], token=self.token)[1]["state"], "QUEUED")
        self.assertEqual([path for path, _ in self.model.requests], ["/api/show"])

    def test_project_filter_api_rechecks_membership_and_strict_fields(self):
        project = self.f.project(self.peer_token)
        before = self.f.store.path.read_bytes()
        client = Client(origin=self.tls.origin)
        base = {"max_steps": 4, "timeout_seconds": 60}
        for value, code in ((project, "PROJECT_MEMBERSHIP_REQUIRED"), (None, "INVALID_ID"), ("bad", "INVALID_ID")):
            self.refused(code, lambda value=value: client.request("POST", "/v1/jobs/claim", {**base, "project_id": value}, self.token))
        self.refused("UNAUTHORIZED", lambda: client.request("POST", "/v1/jobs/claim", {**base, "project_id": self.project}))
        self.refused("INVALID_FIELDS", lambda: client.request("POST", "/v1/jobs/claim", {**base, "project_id": self.project, "extra": 1}, self.token))
        self.assertEqual(self.f.store.path.read_bytes(), before)

    def test_failed_preflight_blocks_claims_and_inference(self):
        self.submit()
        before = self.f.store.path.read_bytes()
        self.refused("PILOT_INSTANCE_MISMATCH", lambda: self.check(expected_instance=uuid.uuid4().hex))
        self.assertEqual(self.records()[-1]["state"], "BLOCKED")
        self.assertEqual(json.loads((self.folder / "preflight.json").read_bytes())["state"], "BLOCKED")
        self.assertEqual(self.f.store.path.read_bytes(), before)
        self.assertEqual(self.model.requests, [])
        self.assertFalse(any(method == "POST" for method, _, _ in self.tls.exchanges))

    def test_credential_budget_blocks_a_long_batch_before_claiming(self):
        self.submit()
        self.f.store.clock = lambda: self.expiry - 11 * 60_000
        before = self.f.store.path.read_bytes()
        self.refused("PILOT_SESSION_CREDENTIAL_BUDGET", lambda: self.check(max_jobs=16, timeout=120, wait_seconds=300))
        self.assertEqual(self.f.store.path.read_bytes(), before)
        self.assertEqual(self.records()[-1]["state"], "BLOCKED")
        self.assertEqual([path for path, _ in self.model.requests], ["/api/show"])

    def test_failed_task_stops_before_the_next_task(self):
        first, second = self.submit(), self.submit()
        self.model.actions = [{"action": "shell", "arguments": {"command": "never execute"}}]
        self.refused("PILOT_SESSION_ATTENTION_REQUIRED", lambda: self.check(max_jobs=2))
        self.assertEqual(self.f.store.call("GET", "/v1/jobs/" + first["id"], token=self.token)[1]["state"], "FAILED")
        self.assertEqual(self.f.store.call("GET", "/v1/jobs/" + second["id"], token=self.token)[1]["state"], "QUEUED")
        self.assertEqual(self.records()[-1]["jobs_recorded"], 1)
        self.assertEqual(self.records()[-1]["state"], "ATTENTION_REQUIRED")
        self.f.store.audit()

    def test_lost_claim_response_is_recorded_as_uncertain_without_retry(self):
        job = self.submit()
        original = Client._request

        def lose(client, method, path, *args, **kwargs):
            result = original(client, method, path, *args, **kwargs)
            if path.startswith("/v1/jobs/claim?"):
                raise ConnectionResetError("injected lost committed claim response")
            return result

        with patch.object(Client, "_request", lose):
            self.refused("PILOT_SESSION_CONNECTION_FAILED", self.check)
        self.assertEqual(sum(path.startswith("/v1/jobs/claim?") for path in self.tls.requests), 1)
        self.assertEqual([path for path, _ in self.model.requests], ["/api/show"])
        self.assertEqual(self.f.store.call("GET", "/v1/jobs/" + job["id"], token=self.token)[1]["state"], "RUNNING")
        rows = self.records()
        self.assertEqual(rows[-2]["phase"], "CLAIM_STARTED")
        self.assertEqual(rows[-1]["outcome"], "NO_CONFIRMED_TASK_RESULT")
        self.assertEqual(rows[-1]["state"], "ATTENTION_REQUIRED")
        self.f.store.audit()

    def test_lost_completion_responses_never_repeat_inference_or_hide_uncertainty(self):
        job = self.submit()
        original = Client._request

        def lose(client, method, path, *args, **kwargs):
            result = original(client, method, path, *args, **kwargs)
            if "/complete?" in path:
                raise ConnectionResetError("injected lost committed completion response")
            return result

        with patch.object(Client, "_request", lose):
            self.refused("PILOT_SESSION_ATTENTION_REQUIRED", self.check)
        self.assertEqual(sum("/complete?" in path for path in self.tls.requests), 2)
        self.assertEqual(len([path for path, _ in self.model.requests if path == "/api/chat"]), 2)
        saved = self.f.store.call("GET", "/v1/jobs/" + job["id"], token=self.token)[1]
        self.assertEqual(saved["state"], "SUCCEEDED")
        outcome = next(row for row in self.records() if row["phase"] == "JOB_RESULT")
        self.assertEqual(outcome["state"], "UNCONFIRMED")
        self.assertFalse(outcome["completion_recorded"])
        self.assertEqual(outcome["report_sha256"], saved["report_sha256"])
        self.f.store.audit()

    def test_journal_fsync_failure_after_claim_stops_before_inference(self):
        job = self.submit()
        original = SessionJournal.record

        def fail(journal, phase, **data):
            if phase == "CLAIMED":
                with patch("zoora_community.pilot_session.os.fsync", side_effect=OSError("injected disk full")):
                    return original(journal, phase, **data)
            return original(journal, phase, **data)

        with patch.object(SessionJournal, "record", fail):
            self.refused("PILOT_SESSION_RECORD_UNAVAILABLE", self.check)
        self.assertNotIn("SESSION_FINISHED", [row["phase"] for row in self.records()])
        self.assertEqual([path for path, _ in self.model.requests], ["/api/show"])
        self.assertEqual(self.f.store.call("GET", "/v1/jobs/" + job["id"], token=self.token)[1]["state"], "RUNNING")
        self.assertFalse(any("/complete?" in path for path in self.tls.requests))

    def test_actual_process_death_retains_a_nonterminal_fsynced_record(self):
        job = self.submit()
        self.model.slow = True
        child = subprocess.Popen(self.command(), env=self.environment(), stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            deadline = time.monotonic() + 20
            while not any(path == "/api/chat" for path, _ in self.model.requests) and time.monotonic() < deadline:
                if child.poll() is not None:
                    break
                time.sleep(.02)
            self.assertTrue(any(path == "/api/chat" for path, _ in self.model.requests))
            child.terminate()
            child.communicate(timeout=10)
            self.assertNotEqual(child.returncode, 0)
            rows = self.records()
            self.assertEqual(rows[-1]["phase"], "CLAIMED")
            self.assertNotIn("SESSION_FINISHED", [row["phase"] for row in rows])
            self.assertEqual(self.f.store.call("GET", "/v1/jobs/" + job["id"], token=self.token)[1]["state"], "RUNNING")
            self.assertFalse(any("/complete?" in path for path in self.tls.requests))
            self.f.store.audit()
        finally:
            if child.poll() is None:
                child.kill()
            child.communicate(timeout=10)

    def test_keyboard_interrupt_is_recorded_and_cannot_be_completed(self):
        self.submit()
        original = SessionJournal.record

        def interrupt(journal, phase, **data):
            original(journal, phase, **data)
            if phase == "CLAIMED":
                raise KeyboardInterrupt

        with patch.object(SessionJournal, "record", interrupt):
            self.refused("PILOT_SESSION_INTERRUPTED", self.check)
        self.assertEqual(self.records()[-1]["state"], "INTERRUPTED")
        self.assertEqual([path for path, _ in self.model.requests], ["/api/show"])

    def test_unexpected_exit_does_not_write_a_successful_footer(self):
        with patch("zoora_community.pilot_session.work_jobs", side_effect=SystemExit(99)):
            with self.assertRaises(SystemExit):
                self.check()
        self.assertEqual(self.records()[-1]["state"], "INTERRUPTED")
        self.assertFalse(any(method == "POST" for method, _, _ in self.tls.exchanges))

    def test_existing_directory_and_invalid_inputs_fail_before_network(self):
        for overrides in ({"max_jobs": 17}, {"wait_seconds": 301}, {"timeout": 0}, {"max_steps": True},
                          {"model": "cloud-alias"}, {"collaboration_project": "bad"}, {"expected_agent": "bad"}):
            with self.assertRaises(Problem):
                self.check(**overrides)
        self.assertFalse(self.folder.exists())
        self.folder.mkdir()
        marker = self.folder / "existing.txt"
        marker.write_text("preserve")
        self.refused("PILOT_SESSION_DIRECTORY_EXISTS", self.check)
        self.assertEqual(marker.read_text(), "preserve")
        self.assertEqual(self.tls.exchanges, [])
        self.assertEqual(self.model.requests, [])

    def test_malformed_remote_claim_metadata_is_not_saved_or_used_for_inference(self):
        self.submit()
        original = Client._request

        def corrupt(client, method, path, *args, **kwargs):
            status, response = original(client, method, path, *args, **kwargs)
            if path.startswith("/v1/jobs/claim?"):
                response["job"]["worker_credential_id"] = self.token
            return status, response

        with patch.object(Client, "_request", corrupt):
            self.refused("PILOT_SESSION_REQUEST_FAILED", self.check)
        self.assertNotIn(self.token, (self.folder / "session.jsonl").read_text())
        self.assertEqual([path for path, _ in self.model.requests], ["/api/show"])
        self.assertNotIn("CLAIMED", [row["phase"] for row in self.records()])

    def test_unknown_remote_error_codes_are_redacted(self):
        secret = "PRIVATE_REMOTE_ERROR_SECRET"
        with patch.object(self.f.store, "_jobs_write", side_effect=Problem(503, secret)):
            self.refused("PILOT_SESSION_REQUEST_FAILED", self.check)
        self.assertNotIn(secret, (self.folder / "session.jsonl").read_text())
        self.assertEqual(self.records()[-1]["state"], "ATTENTION_REQUIRED")


if __name__ == "__main__":
    unittest.main()
