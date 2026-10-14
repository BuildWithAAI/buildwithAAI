"""Actual HTTP/CLI workers with a SYNTHETIC protocol fixture, not real AI acceptance."""

import hashlib
import json
from pathlib import Path
import subprocess
import sys
import threading
import time
import unittest
from unittest.mock import patch
import uuid

from helpers import Fixture
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
from model_fixture import ModelFixture  # noqa: E402
from zoora_community.agent_runner import LocalModel  # noqa: E402
from zoora_community.client import Client  # noqa: E402
from zoora_community.job_worker import work_jobs  # noqa: E402
from zoora_community.store import Store  # noqa: E402
from zoora_community.validation import Problem, canonical  # noqa: E402
from zoora_community.wsgi_server import WSGIServer  # noqa: E402


class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.f = Fixture(real_time=True)
        self.addCleanup(self.f.close)
        _, self.operator = self.f.operator()
        result = self.f.store.call("POST", "/v1/agents", self.f.enrollment(self.operator, "worker_agent"), self.operator)[1]
        self.agent_id, self.agent = result["agent"]["id"], result["credential"]["token"]
        self.credential = self.f.root / "agent.json"
        self.credential.write_text(canonical(result["credential"]))
        self.credential.chmod(0o600)
        self.project = self.f.project(self.agent)
        self.folder = self.f.root / "reports"
        self.server = WSGIServer(self.f.store, 0)
        self.thread = threading.Thread(target=self.server.serve_forever)
        self.thread.start()
        self.addCleanup(self.stop_server)
        self.client = Client(self.server.server_port)

    def stop_server(self):
        self.server.shutdown()
        self.thread.join(10)
        self.assertFalse(self.thread.is_alive())

    def model(self, **kwargs):
        fixture = ModelFixture(**kwargs).start()
        self.addCleanup(fixture.stop)
        return fixture

    def submit(self):
        body = {"request_id": uuid.uuid4().hex, "title": "Declared synthetic report", "prompt": "PRIVATE task to measure Zoora builds.", "project_id": self.project}
        return self.client.request("POST", "/v1/jobs", body, self.agent)[1]["job"]

    def worker(self, fixture, **kwargs):
        return work_jobs(self.credential, self.folder, model="synthetic-fixture",
                         port=self.server.server_port, model_port=fixture.port, **kwargs)

    def test_cli_success_private_report_hash_binding_restart_and_no_secrets(self):
        job = self.submit()
        fixture = self.model()
        completed = subprocess.run([sys.executable, "-bb", "-X", "dev", "-W", "error", "-m", "zoora_community", "work-jobs",
                                    "--credential-file", str(self.credential), "--out-dir", str(self.folder), "--model", "synthetic-fixture",
                                    "--port", str(self.server.server_port), "--model-port", str(fixture.port)],
                                   capture_output=True, text=True, timeout=20)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        result = json.loads(completed.stdout)["jobs"][0]
        self.assertEqual(result["state"], "SUCCEEDED")
        raw = next(self.folder.glob("*.json")).read_bytes()
        report = json.loads(raw)
        self.assertEqual(report["job"], {"job_id": job["id"], "attempt_id": result["attempt_id"]})
        self.assertEqual(result["report_sha256"], hashlib.sha256(raw).hexdigest())
        self.assertEqual(report["steps"][0]["tool_result"]["words"], 2)
        artifacts = self.client.request("GET", "/v1/projects/" + self.project + "/artifacts")[1]["items"]
        self.assertEqual(artifacts[0]["digest"], result["report_sha256"])
        self.assertEqual(artifacts[0]["author_id"], self.agent_id)
        combined = completed.stdout + completed.stderr + raw.decode() + canonical(fixture.requests)
        self.assertNotIn(self.agent, combined)
        self.assertNotIn("jr1_", combined)
        self.assertNotIn("PRIVATE task", completed.stdout + completed.stderr)
        self.assertNotIn("SYNTHETIC fixture output", completed.stdout + completed.stderr)
        if sys.platform != "win32":
            self.assertEqual(self.folder.stat().st_mode & 0o077, 0)
        restarted = Store(self.f.state)
        self.assertEqual(restarted.call("GET", "/v1/jobs/" + job["id"], token=self.agent)[1]["state"], "SUCCEEDED")
        self.assertEqual(self.worker(fixture)["processed"], 0)
        self.assertEqual(len(fixture.requests), 3)
        restarted.audit()

    def test_unsafe_tool_fails_with_private_report_and_no_publication(self):
        job = self.submit()
        fixture = self.model(actions=[{"action": "shell", "arguments": {"command": "must not execute"}}])
        result = self.worker(fixture)["jobs"][0]
        self.assertEqual(result["state"], "FAILED")
        self.assertEqual(result["error_code"], "TOOL_NOT_ALLOWED")
        report = json.loads(next(self.folder.glob("*.json")).read_bytes())
        self.assertEqual(report["state"], "FAILED")
        self.assertIsNone(result["artifact_id"])
        self.assertEqual(self.client.request("GET", "/v1/jobs/" + job["id"], token=self.agent)[1]["state"], "FAILED")
        self.f.store.audit()

    def test_stop_during_model_call_prevents_tool_and_publication(self):
        job = self.submit()
        fixture = self.model()
        original = LocalModel.next_action

        def stop_before_response(provider, *args, **kwargs):
            response = original(provider, *args, **kwargs)
            self.client.request("POST", "/v1/jobs/" + job["id"] + "/stop", {}, self.operator)
            return response

        with patch.object(LocalModel, "next_action", stop_before_response), patch("zoora_community.agent_runner.run_tool") as tool:
            result = self.worker(fixture)["jobs"][0]
            tool.assert_not_called()
        self.assertEqual(result["state"], "CANCELLED")
        self.assertEqual(result["error_code"], "JOB_STOPPED")
        self.assertIsNone(result["artifact_id"])
        self.assertEqual(len(fixture.requests), 2)  # show + in-flight chat, no second chat
        self.f.store.audit()

    def test_lost_completion_response_reconciles_without_second_inference(self):
        self.submit()
        fixture = self.model()
        original = Client.request
        lost = False

        def lose_response(client, method, path, *args, **kwargs):
            nonlocal lost
            result = original(client, method, path, *args, **kwargs)
            if path.endswith("/complete") and not lost:
                lost = True
                raise ConnectionResetError("injected committed-response loss")
            return result

        with patch.object(Client, "request", lose_response):
            result = self.worker(fixture)["jobs"][0]
        self.assertEqual(result["state"], "SUCCEEDED")
        self.assertEqual(len(fixture.requests), 3)
        self.assertEqual(len(self.client.request("GET", "/v1/projects/" + self.project + "/artifacts")[1]["items"]), 1)
        self.f.store.audit()

    def test_revocation_between_calls_keeps_report_but_cannot_settle_or_retry(self):
        job = self.submit()
        fixture = self.model()
        original = LocalModel.next_action

        def revoke(provider, *args, **kwargs):
            response = original(provider, *args, **kwargs)
            self.client.request("POST", "/v1/agents/" + self.agent_id + "/credentials", {}, self.operator)
            return response

        with patch.object(LocalModel, "next_action", revoke):
            result = self.worker(fixture)["jobs"][0]
        self.assertEqual(result["state"], "UNCONFIRMED")
        self.assertFalse(result["completion_recorded"])
        self.assertTrue(result["report_sha256"])
        self.assertEqual(len(fixture.requests), 2)
        self.assertEqual(self.client.request("GET", "/v1/jobs/" + job["id"], token=self.operator)[1]["state"], "INTERRUPTED")
        self.assertEqual(self.client.request("GET", "/v1/projects/" + self.project + "/artifacts")[1]["items"], [])

    def test_host_validation_precedes_claim_and_existing_report_not_overwritten(self):
        job = self.submit()
        fixture = self.model()
        for kwargs in ({"max_jobs": 17}, {"wait_seconds": 301}, {"timeout": 0}, {"max_steps": True}):
            with self.assertRaises(Problem):
                self.worker(fixture, **kwargs)
        with self.assertRaises(Problem):
            work_jobs(self.credential, self.folder, model="qwen:cloud", port=self.server.server_port)
        self.assertEqual(self.client.request("GET", "/v1/jobs/" + job["id"], token=self.agent)[1]["state"], "QUEUED")
        self.folder.mkdir(mode=0o700)
        original = Client.request
        path = None

        def collide(client, method, route, *args, **kwargs):
            nonlocal path
            result = original(client, method, route, *args, **kwargs)
            if route == "/v1/jobs/claim" and result[1]["job"]:
                claimed = result[1]["job"]
                path = self.folder / (claimed["id"] + "-" + claimed["attempt_id"] + ".json")
                path.write_text("preserved existing file")
            return result

        with patch.object(Client, "request", collide):
            result = self.worker(fixture)["jobs"][0]
        self.assertEqual(path.read_text(), "preserved existing file")
        self.assertEqual(result["state"], "FAILED")
        self.assertIsNone(result["report_sha256"])
        self.assertEqual(fixture.requests, [])
        self.f.store.audit()

    def test_slow_model_deadline_settles_failure_and_does_not_hang(self):
        self.submit()
        fixture = self.model(slow=True)
        started = time.monotonic()
        result = self.worker(fixture, timeout=1)["jobs"][0]
        self.assertLess(time.monotonic() - started, 2)
        self.assertEqual(result["state"], "FAILED")
        self.assertEqual(result["error_code"], "RUN_DEADLINE")
        self.assertIsNone(result["artifact_id"])
        self.f.store.audit()
