"""Actual TLS/Waitress/SQLite connection guards; model replies are SYNTHETIC."""

import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit
import uuid

from helpers import Fixture
from test_private_pilot import TLSCommunity
from model_fixture import ModelFixture
from zoora_community.agent_runner import LocalModel, run_agent
from zoora_community.client import Client
from zoora_community.job_worker import work_jobs
from zoora_community.validation import Problem, canonical


class ConnectionBindingTests(unittest.TestCase):
    def setUp(self):
        self.f = Fixture(real_time=True)
        self.addCleanup(self.f.close)
        _, self.operator = self.f.operator()
        self.agent, self.token = self.f.agent(self.operator, "bound_alpha")
        self.peer, self.peer_token = self.f.agent(self.operator, "bound_beta")
        self.project = self.f.project(self.token)
        self.instance = self.f.store.call("GET", "/v1/status")[1]["instance_id"]
        principal = self.f.store.call("GET", "/v1/me", token=self.token)[1]
        self.credential = self.f.root / "agent.json"
        self.credential.write_text(canonical({**principal, "token": self.token}), encoding="utf-8")
        self.credential.chmod(0o600)
        self.task = self.f.root / "task.json"
        self.task.write_text(canonical({"prompt": "PRIVATE task; measure Zoora builds."}), encoding="utf-8")
        self.folder, self.out = self.f.root / "reports", self.f.root / "direct.json"
        self.tls = TLSCommunity(self.f.store)
        self.addCleanup(self.tls.stop)
        self.trust = patch("zoora_community.client.ssl.create_default_context", return_value=self.tls.client_context)
        self.trust.start()
        self.addCleanup(self.trust.stop)
        self.client = Client(origin=self.tls.origin, expected_instance=self.instance, expected_agent=self.agent)
        self.model = ModelFixture().start()
        self.addCleanup(self.model.stop)

    def refused(self, code, action):
        with self.assertRaises(Problem) as denied:
            action()
        self.assertEqual(denied.exception.code, code)

    def submit(self):
        return self.f.store.call("POST", "/v1/jobs", {"request_id": uuid.uuid4().hex,
            "title": "Bound pilot", "prompt": "PRIVATE task; measure Zoora builds.", "project_id": self.project}, self.token)[1]["job"]

    def worker(self, **overrides):
        options = dict(model="synthetic-fixture", model_port=self.model.port, community_origin=self.tls.origin,
                       expected_instance=self.instance, expected_agent=self.agent, collaboration_project=self.project)
        options.update(overrides)
        return work_jobs(self.credential, self.folder, **options)

    def direct(self, **overrides):
        options = dict(model="synthetic-fixture", model_port=self.model.port, community_origin=self.tls.origin,
                       expected_instance=self.instance, expected_agent=self.agent)
        options.update(overrides)
        return run_agent(self.credential, self.task, self.out, **options)

    def test_remote_runners_require_both_pins_before_network_or_output(self):
        for action in (self.worker, self.direct):
            for pins in ({"expected_instance": None}, {"expected_agent": None},
                         {"expected_instance": None, "expected_agent": None}):
                self.refused("WORKER_CONNECTION_PINS_REQUIRED", lambda action=action, pins=pins: action(**pins))
        self.assertEqual(self.tls.exchanges, [])
        self.assertEqual(self.model.requests, [])
        self.assertFalse(self.folder.exists())
        self.assertFalse(self.out.exists())

    def test_malformed_pins_fail_locally(self):
        for field in ("expected_instance", "expected_agent"):
            for value in ("", "A" * 32, self.token, [], True):
                self.refused("INVALID_ID", lambda field=field, value=value: self.worker(**{field: value}))
        self.assertEqual(self.tls.exchanges, [])
        self.assertEqual(self.model.requests, [])

    def test_mismatched_instance_does_not_send_bearer_claim_or_infer(self):
        self.submit()
        before = self.f.store.path.read_bytes()
        self.refused("COMMUNITY_INSTANCE_MISMATCH", lambda: self.worker(expected_instance=uuid.uuid4().hex))
        self.assertEqual(len(self.tls.exchanges), 1)
        self.assertFalse(self.tls.exchanges[0][2])
        self.assertEqual(self.f.store.path.read_bytes(), before)
        self.assertEqual(self.model.requests, [])

    def test_wrong_agent_or_privileged_credential_cannot_claim(self):
        job = self.submit()
        before = self.f.store.path.read_bytes()
        self.refused("COMMUNITY_AGENT_MISMATCH", lambda: self.worker(expected_agent=self.peer))
        self.refused("COMMUNITY_AGENT_MISMATCH", lambda: self.client.request("POST", "/v1/jobs/claim",
                     {"max_steps": 4, "timeout_seconds": 60}, self.operator))
        self.assertEqual(self.f.store.path.read_bytes(), before)
        self.assertEqual(self.f.store.call("GET", "/v1/jobs/" + job["id"], token=self.token)[1]["state"], "QUEUED")
        self.assertEqual(self.model.requests, [])

    def test_actual_pinned_worker_binds_every_request_and_saved_report(self):
        job = self.submit()
        result = self.worker()["jobs"][0]
        self.assertEqual(result["state"], "SUCCEEDED")
        report_path = next(self.folder.glob("*.json"))
        report = json.loads(report_path.read_bytes())
        self.assertEqual(report["connection_binding"], self.client.binding())
        self.assertEqual(result["report_sha256"], hashlib.sha256(report_path.read_bytes()).hexdigest())
        paths = []
        for _, target, authenticated in self.tls.exchanges:
            parts = urlsplit(target)
            pins = parse_qs(parts.query)
            self.assertEqual(pins["expected_instance"], [self.instance])
            if authenticated:
                self.assertEqual(pins["expected_agent"], [self.agent])
                paths.append(parts.path)
        self.assertIn("/v1/jobs/claim", paths)
        self.assertIn("/v1/jobs/" + job["id"] + "/heartbeat", paths)
        self.assertIn("/v1/jobs/" + job["id"] + "/complete", paths)
        for secret in (self.token, self.peer_token, self.operator):
            self.assertNotIn(secret, canonical(self.model.requests))
            self.assertNotIn(secret, report_path.read_text())
        self.f.store.audit()

    def test_service_switch_after_probe_is_rejected_atomically_before_auth(self):
        self.submit()
        other = Fixture(real_time=True)
        self.addCleanup(other.close)
        before, other_before = self.f.store.path.read_bytes(), other.store.path.read_bytes()
        original = Client._request

        def switch(client, method, path, *args, **kwargs):
            if path.startswith("/v1/jobs/claim?"):
                self.tls.backend.application.store = other.store
            return original(client, method, path, *args, **kwargs)

        with patch.object(Client, "_request", switch), patch.object(other.store, "_authenticate") as authenticate:
            self.refused("COMMUNITY_INSTANCE_MISMATCH", self.worker)
            authenticate.assert_not_called()
        self.assertEqual(self.f.store.path.read_bytes(), before)
        self.assertEqual(other.store.path.read_bytes(), other_before)
        self.assertEqual(self.model.requests, [])
        self.assertEqual(list(self.folder.glob("*.json")), [])

    def test_switch_during_inference_blocks_tools_completion_and_next_job(self):
        job, next_job = self.submit(), self.submit()
        other = Fixture(real_time=True)
        self.addCleanup(other.close)
        other_before = other.store.path.read_bytes()
        original = LocalModel.next_action

        def switch(provider, *args, **kwargs):
            response = original(provider, *args, **kwargs)
            self.tls.backend.application.store = other.store
            return response

        with patch.object(LocalModel, "next_action", switch), patch("zoora_community.agent_runner.run_tool") as tool:
            result = self.worker(max_jobs=2)
            tool.assert_not_called()
        self.assertEqual(result["processed"], 1)
        self.assertEqual(result["jobs"][0]["state"], "UNCONFIRMED")
        self.assertFalse(result["jobs"][0]["completion_recorded"])
        self.assertEqual(other.store.path.read_bytes(), other_before)
        self.assertEqual(len(self.model.requests), 2)
        report = json.loads(next(self.folder.glob("*.json")).read_bytes())
        self.assertEqual(report["error"], "COMMUNITY_INSTANCE_MISMATCH")
        self.assertIsNone(report["output"])
        self.assertEqual(self.f.store.call("GET", "/v1/jobs/" + job["id"], token=self.token)[1]["state"], "RUNNING")
        self.assertEqual(self.f.store.call("GET", "/v1/jobs/" + next_job["id"], token=self.token)[1]["state"], "QUEUED")
        self.assertEqual(self.f.store.call("GET", "/v1/projects/" + self.project + "/artifacts", token=self.token)[1]["items"], [])
        self.f.store.audit()

    def test_direct_runner_checks_after_inference_before_local_tool(self):
        other = Fixture(real_time=True)
        self.addCleanup(other.close)
        original = LocalModel.next_action

        def switch(provider, *args, **kwargs):
            response = original(provider, *args, **kwargs)
            self.tls.backend.application.store = other.store
            return response

        with patch.object(LocalModel, "next_action", switch), patch("zoora_community.agent_runner.run_tool") as tool:
            self.refused("COMMUNITY_INSTANCE_MISMATCH", self.direct)
            tool.assert_not_called()
        report = json.loads(self.out.read_bytes())
        self.assertEqual(report["state"], "FAILED")
        self.assertIsNone(report["output"])
        self.assertEqual(len(self.model.requests), 2)

    def test_switch_before_completion_never_retries_or_requeues(self):
        job = self.submit()
        other = Fixture(real_time=True)
        self.addCleanup(other.close)
        original = Client._request

        def switch(client, method, path, *args, **kwargs):
            if "/complete?" in path:
                self.tls.backend.application.store = other.store
            return original(client, method, path, *args, **kwargs)

        with patch.object(Client, "_request", switch):
            result = self.worker()["jobs"][0]
        self.assertEqual(result["state"], "UNCONFIRMED")
        self.assertTrue(result["report_sha256"])
        self.assertEqual(len([path for _, path, _ in self.tls.exchanges if "/complete?" in path]), 1)
        self.assertEqual(self.f.store.call("GET", "/v1/jobs/" + job["id"], token=self.token)[1]["state"], "RUNNING")
        self.f.store.audit()

    def test_old_service_protocol_and_malformed_status_never_receive_bearer(self):
        original = self.f.store._read
        for change in ({"connection_binding": None}, {"service": "zoora-agent-community/older"}):
            def incompatible(*args, change=change, **kwargs):
                code, response = original(*args, **kwargs)
                response.update(change)
                return code, response

            self.tls.exchanges.clear()
            with patch.object(self.f.store, "_read", incompatible):
                self.refused("COMMUNITY_BINDING_UNSUPPORTED", lambda: self.client.request("GET", "/v1/me", token=self.token))
            self.assertEqual(len(self.tls.exchanges), 1)
            self.assertFalse(self.tls.exchanges[0][2])
        with patch.object(self.f.store, "_read", return_value=(200, [self.token])):
            self.refused("COMMUNITY_IDENTITY_UNCONFIRMED", lambda: self.client.request("GET", "/v1/me", token=self.token))

    def test_probe_errors_cannot_echo_remote_content(self):
        for body in (self.token, [self.token], {"secret": self.token}):
            with patch.object(self.f.store, "_read", side_effect=Problem(503, body)):
                self.refused("COMMUNITY_IDENTITY_UNCONFIRMED", lambda: self.client.request("GET", "/v1/me", token=self.token))
        self.assertFalse(any(authenticated for _, _, authenticated in self.tls.exchanges))

    def test_query_pins_reject_blank_duplicate_unpaired_and_extra_values(self):
        unbound = Client(origin=self.tls.origin)
        base = "/v1/jobs/claim?expected_instance=" + self.instance
        before = self.f.store.path.read_bytes()
        for target, code in ((base + "&expected_instance=" + self.instance, "INVALID_PAGINATION"),
                             ("/v1/jobs/claim?expected_instance=", "INVALID_ID"),
                             ("/v1/jobs/claim?expected_agent=" + self.agent, "WORKER_CONNECTION_PINS_REQUIRED"),
                             (base + "&expected_agent=" + self.agent + "&limit=1", "INVALID_ROUTE"),
                             (base + "&bogus=1", "INVALID_PAGINATION"),
                             (base + "&expected_agent=bad", "INVALID_ID")):
            self.refused(code, lambda target=target: unbound.request("POST", target, {"max_steps": 4, "timeout_seconds": 60}, self.token))
        self.refused("COMMUNITY_BINDING_UNSUPPORTED", lambda: self.client.request("GET", "/v1/ready", token=self.token))
        self.assertEqual(self.f.store.path.read_bytes(), before)

    def test_bound_pagination_retains_membership_checks(self):
        self.assertEqual(self.client.request("GET", "/v1/projects/" + self.project + "/discussion?limit=1", token=self.token)[1]["items"], [])
        peer = Client(origin=self.tls.origin, expected_instance=self.instance, expected_agent=self.peer)
        self.refused("PROJECT_MEMBERSHIP_REQUIRED", lambda: peer.request("GET", "/v1/projects/" + self.project + "/discussion?limit=1", token=self.peer_token))

    def test_expired_deadline_prevents_probe_and_bearer(self):
        self.client.deadline = time.monotonic() - 1
        self.refused("RUN_DEADLINE", lambda: self.client.request("GET", "/v1/me", token=self.token))
        self.assertEqual(self.tls.exchanges, [])

    def test_cli_pinned_worker_and_direct_report_with_real_tls(self):
        job = self.submit()
        env = {**os.environ, "SSL_CERT_FILE": str(Path(__file__).parent / "fixtures/bridge-localhost-cert.pem")}
        common = ["--community-origin", self.tls.origin, "--expected-instance", self.instance,
                  "--expected-agent", self.agent, "--credential-file", str(self.credential),
                  "--model", "synthetic-fixture", "--model-port", str(self.model.port)]
        for command, extra in (("work-jobs", ["--out-dir", str(self.folder)]),
                               ("run-agent", ["--task-file", str(self.task), "--out", str(self.out)])):
            completed = subprocess.run([sys.executable, "-bb", "-X", "dev", "-W", "error", "-m", "zoora_community", command,
                                        *common, *extra], env=env, capture_output=True, text=True, timeout=30)
            self.assertEqual(completed.returncode, 0, completed.stderr)
            result = json.loads(completed.stdout)
            self.assertTrue(result["connection_binding"]["enforced"])
            if command == "work-jobs":
                self.assertEqual(result["jobs"][0]["job_id"], job["id"])
                self.assertEqual(result["jobs"][0]["state"], "SUCCEEDED")
            self.assertNotIn(self.token, completed.stdout + completed.stderr)
        self.f.store.audit()

    def test_cli_remote_worker_without_pins_exits_nonzero_before_io(self):
        completed = subprocess.run([sys.executable, "-bb", "-X", "dev", "-W", "error", "-m", "zoora_community", "work-jobs",
            "--community-origin", self.tls.origin, "--credential-file", str(self.credential),
            "--out-dir", str(self.folder), "--model", "synthetic-fixture"], capture_output=True, text=True, timeout=10)
        self.assertNotEqual(completed.returncode, 0)
        self.assertEqual(json.loads(completed.stderr)["error"], "WORKER_CONNECTION_PINS_REQUIRED")
        self.assertEqual(self.tls.exchanges, [])


if __name__ == "__main__":
    unittest.main()
