"""Actual TLS/Waitress/SQLite and model metadata; model fixture is SYNTHETIC."""

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
from zoora_community.agent_runner import LocalModel
from zoora_community.client import Client
from zoora_community.pilot_preflight import MIN_CREDENTIAL_MS, pilot_preflight
from zoora_community.validation import Problem, canonical


class PilotPreflightTests(unittest.TestCase):
    def setUp(self):
        self.f = Fixture(real_time=True)
        self.addCleanup(self.f.close)
        _, self.operator = self.f.operator()
        self.agent, self.token = self.f.agent(self.operator, "preflight_alpha")
        self.peer, self.peer_token = self.f.agent(self.operator, "preflight_beta")
        self.project = self.f.project(self.token)
        self.tls = TLSCommunity(self.f.store)
        self.addCleanup(self.tls.stop)
        self.trust = patch("zoora_community.client.ssl.create_default_context",
                           return_value=self.tls.client_context)
        self.trust.start()
        self.addCleanup(self.trust.stop)
        self.principal = self.f.store.call("GET", "/v1/me", token=self.token)[1]
        self.instance = self.f.store.call("GET", "/v1/status")[1]["instance_id"]
        self.credential = self.f.root / "agent.json"
        self.credential.write_text(canonical({**self.principal, "token": self.token}), encoding="utf-8")
        self.credential.chmod(0o600)
        self.out = self.f.root / "preflight.json"
        self.model = ModelFixture().start()
        self.addCleanup(self.model.stop)

    def check(self, **kwargs):
        options = dict(community_origin=self.tls.origin, expected_instance=self.instance,
                       expected_agent=self.agent, collaboration_project=self.project,
                       model="synthetic-fixture", model_port=self.model.port)
        options.update(kwargs)
        return pilot_preflight(self.credential, self.out, **options)

    def blocked(self, code, **kwargs):
        with self.assertRaises(Problem) as denied:
            self.check(**kwargs)
        self.assertEqual(denied.exception.code, code)
        report = json.loads(self.out.read_bytes())
        self.assertEqual(report["state"], "BLOCKED")
        self.assertEqual(report["error_code"], code)
        self.assertNotIn(self.token, self.out.read_text())
        self.assertNotIn(self.operator, self.out.read_text())
        return report

    def test_actual_tls_success_is_read_only_without_inference_or_private_content(self):
        secret = "PRIVATE peer note and task content must stay out of preflight"
        self.f.store.call("POST", "/v1/posts", {"project_id": self.project, "body": secret}, self.token)
        self.f.store.call("POST", "/v1/jobs", {"request_id": uuid.uuid4().hex,
            "title": "Private", "prompt": secret, "project_id": self.project}, self.token)
        database = self.f.state / "community.sqlite3"
        before = database.read_bytes()
        requests, original = [], Client.request

        def record(client, method, path, body=None, token=None):
            requests.append((method, path))
            return original(client, method, path, body, token)

        with patch.object(Client, "request", record):
            result = self.check()
        self.assertEqual(result["state"], "READY_FOR_SUPERVISED_SESSION")
        self.assertEqual(result["checks_passed"], 6)
        self.assertEqual(result["report_sha256"], hashlib.sha256(self.out.read_bytes()).hexdigest())
        self.assertEqual(database.read_bytes(), before)
        self.assertTrue(all(method == "GET" for method, _ in requests))
        self.assertEqual([path for path, _ in self.model.requests], ["/api/show"])
        for private in (secret, self.token, self.operator, self.peer_token):
            self.assertNotIn(private, self.out.read_text())
            self.assertNotIn(private, canonical(self.model.requests))
        report = json.loads(self.out.read_bytes())
        self.assertTrue(report["point_in_time_only"])
        self.assertFalse(report["worker_connections_pinned"])
        self.assertFalse(report["model_inference"])
        self.assertEqual(report["community_mutations"], 0)
        if os.name == "posix":
            self.assertEqual(self.out.stat().st_mode & 0o077, 0)
        self.f.store.audit()

    def test_instance_mismatch_blocks_before_transmitting_the_bearer(self):
        sent, original = [], Client.request

        def record(client, method, path, body=None, token=None):
            sent.append((path, token is not None))
            return original(client, method, path, body, token)

        with patch.object(Client, "request", record):
            self.blocked("PILOT_INSTANCE_MISMATCH", expected_instance=uuid.uuid4().hex)
        self.assertEqual(sent, [("/v1/status", False)])
        self.assertEqual(self.model.requests, [])

    def test_wrong_service_release_is_refused_before_authentication(self):
        original = Client.request

        def older(client, method, path, *args, **kwargs):
            status, result = original(client, method, path, *args, **kwargs)
            if path == "/v1/status":
                result["service"] = "zoora-agent-community/older"
            return status, result

        with patch.object(Client, "request", older):
            self.blocked("PILOT_SERVICE_MISMATCH")
        self.assertEqual(self.tls.requests, ["/v1/status"])

    def test_public_records_mode_cannot_pass_a_private_pilot_check(self):
        self.f.store.private_pilot = False
        self.blocked("PILOT_PRIVATE_MODE_REQUIRED")
        self.assertEqual(self.model.requests, [])

    def test_private_status_label_does_not_replace_an_actual_anonymous_denial(self):
        self.f.store.private_pilot = False
        original = Client.request

        def mislabeled(client, method, path, *args, **kwargs):
            status, result = original(client, method, path, *args, **kwargs)
            if path == "/v1/status":
                result["visibility"] = "PRIVATE_PILOT"
            return status, result

        with patch.object(Client, "request", mislabeled):
            self.blocked("PILOT_PRIVACY_UNCONFIRMED")
        self.assertEqual(self.tls.requests, ["/v1/status", "/v1/agents?limit=1"])

    def test_wrong_agent_is_blocked_before_project_or_model_reads(self):
        self.blocked("PILOT_AGENT_MISMATCH", expected_agent=self.peer)
        self.assertEqual(self.model.requests, [])
        self.assertFalse(any("discussion" in path for path in self.tls.requests))

    def test_unrelated_project_membership_is_refused(self):
        other = self.f.project(self.peer_token)
        self.blocked("PROJECT_MEMBERSHIP_REQUIRED", collaboration_project=other)
        self.assertEqual(self.model.requests, [])

    def test_nearly_expired_credential_cannot_pass_or_be_renewed(self):
        self.f.store.clock = lambda: self.principal["expires_at_ms"] - MIN_CREDENTIAL_MS + 1
        before = (self.f.state / "community.sqlite3").read_bytes()
        report = self.blocked("PILOT_CREDENTIAL_EXPIRES_SOON")
        self.assertEqual(report["failed_check"], "final_identity_and_credential_validity")
        self.assertEqual((self.f.state / "community.sqlite3").read_bytes(), before)
        self.assertEqual([path for path, _ in self.model.requests], ["/api/show"])

    def test_revocation_during_model_metadata_read_is_rechecked(self):
        original = LocalModel.inspect

        def revoke(provider, deadline):
            result = original(provider, deadline)
            self.f.store.call("POST", "/v1/agents/" + self.agent + "/credentials", {}, self.operator)
            return result

        with patch.object(LocalModel, "inspect", revoke):
            self.blocked("UNAUTHORIZED")
        self.assertEqual([path for path, _ in self.model.requests], ["/api/show"])

    def test_changed_service_instance_is_refused_at_the_final_check(self):
        original = Client.request
        status_reads = 0

        def switched(client, method, path, *args, **kwargs):
            nonlocal status_reads
            status, result = original(client, method, path, *args, **kwargs)
            if path == "/v1/status":
                status_reads += 1
                if status_reads == 2:
                    result["instance_id"] = uuid.uuid4().hex
            return status, result

        with patch.object(Client, "request", switched):
            report = self.blocked("PILOT_INSTANCE_MISMATCH")
        self.assertEqual(report["failed_check"], "final_identity_and_credential_validity")
        self.assertEqual(status_reads, 2)
        self.assertEqual([path for path, _ in self.model.requests], ["/api/show"])

    def test_remote_model_alias_is_refused_without_chat_or_pull(self):
        self.model.remote = True
        self.blocked("LOCAL_MODEL_REQUIRED")
        self.assertEqual([path for path, _ in self.model.requests], ["/api/show"])

    def test_malformed_service_response_is_bounded_and_redacted(self):
        original = Client.request

        def malformed(client, method, path, *args, **kwargs):
            result = original(client, method, path, *args, **kwargs)
            return (200, [self.token]) if path == "/v1/status" else result

        with patch.object(Client, "request", malformed):
            self.blocked("PILOT_RESPONSE_REJECTED")
        self.assertEqual(self.model.requests, [])

    def test_untrusted_error_body_cannot_echo_a_bearer_into_the_report(self):
        original = Client.request

        def untrusted(client, method, path, *args, **kwargs):
            if path == "/v1/me":
                raise Problem(401, self.token)
            return original(client, method, path, *args, **kwargs)

        with patch.object(Client, "request", untrusted):
            self.blocked("PILOT_REQUEST_FAILED")

    def test_non_string_remote_error_is_redacted_without_a_traceback(self):
        original = Client.request

        def untrusted(client, method, path, *args, **kwargs):
            if path == "/v1/me":
                raise Problem(401, [self.token])
            return original(client, method, path, *args, **kwargs)

        with patch.object(Client, "request", untrusted):
            self.blocked("PILOT_REQUEST_FAILED")

    def test_certificate_failure_retains_a_blocked_result_without_plaintext_fallback(self):
        self.trust.stop()
        try:
            self.blocked("PILOT_CONNECTION_FAILED")
        finally:
            self.trust.start()
        self.assertEqual(self.tls.requests, [])
        self.assertEqual(self.model.requests, [])

    def test_redirect_cannot_change_the_destination_or_receive_a_bearer(self):
        self.tls.redirect = True
        self.blocked("COMMUNITY_REDIRECT_REJECTED")
        self.assertEqual(self.tls.requests, ["/v1/status"])
        self.assertEqual(self.model.requests, [])

    def test_existing_output_is_preserved_before_any_connection(self):
        self.out.write_text("preserve original report", encoding="utf-8")
        with patch.object(Client, "request") as request, self.assertRaises(FileExistsError):
            self.check()
        request.assert_not_called()
        self.assertEqual(self.out.read_text(), "preserve original report")
        self.assertEqual(self.model.requests, [])

    def test_actual_cli_retains_a_redacted_result_and_failure_exit(self):
        command = [sys.executable, "-bb", "-X", "dev", "-W", "error", "-m", "zoora_community",
            "pilot-preflight", "--community-origin", self.tls.origin, "--expected-instance", self.instance,
            "--expected-agent", self.agent, "--credential-file", str(self.credential),
            "--collaboration-project", self.project, "--model", "synthetic-fixture",
            "--model-port", str(self.model.port), "--out", str(self.out)]
        # Test-only public CA; the child still verifies the actual TLS hostname/certificate.
        environment = {**os.environ, "SSL_CERT_FILE": str(Path(__file__).parent / "fixtures" / "bridge-localhost-cert.pem")}
        result = subprocess.run(command, capture_output=True, text=True, timeout=15, env=environment)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["report_sha256"], hashlib.sha256(self.out.read_bytes()).hexdigest())
        self.assertNotIn(self.token, result.stdout + result.stderr)
        command[command.index("--expected-instance") + 1] = uuid.uuid4().hex
        command[-1] = str(self.f.root / "blocked.json")
        result = subprocess.run(command, capture_output=True, text=True, timeout=15, env=environment)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(json.loads(result.stderr)["error"], "PILOT_INSTANCE_MISMATCH")
        self.assertNotIn(self.token, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
