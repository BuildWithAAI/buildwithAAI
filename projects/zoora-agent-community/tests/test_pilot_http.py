"""Real Waitress and subprocess CLI acceptance; temporary unfunded fixtures only."""

import http.client
import json
from pathlib import Path
import secrets
import subprocess
import sys
import threading
import unittest
import uuid

from helpers import Fixture
from zoora_community.client import Client, read_credential
from zoora_community.validation import canonical
from zoora_community.wsgi_server import WSGIServer


class PilotHTTPTests(unittest.TestCase):
    def setUp(self):
        self.f = Fixture(real_time=True)
        self.addCleanup(self.f.close)
        self.server = WSGIServer(self.f.store, 0)
        self.thread = threading.Thread(target=self.server.serve_forever)
        self.thread.start()
        self.addCleanup(self.stop)
        self.client = Client(self.server.server_port)
        self.body = {"request_id": uuid.uuid4().hex, "label": "Private CLI invitation", "ttl_seconds": 300}

    def stop(self):
        self.server.shutdown()
        self.thread.join(10)
        self.assertFalse(self.thread.is_alive())

    def command(self, *arguments, body=None):
        args = [sys.executable, "-bb", "-X", "dev", "-W", "error", "-m", "zoora_community", "request", *map(str, arguments), "--port", str(self.server.server_port)]
        if body is not None:
            path = self.f.root / "body.json"
            path.write_text(canonical(body))
            path.chmod(0o600)
            args += ["--body-file", str(path)]
        return subprocess.run(args, cwd=Path(__file__).resolve().parent.parent,
                              capture_output=True, text=True, timeout=20)

    def test_actual_cli_create_claim_retry_and_no_secret_stdout(self):
        invitation_file = self.f.root / "invitation.json"
        result = self.command("POST", "/v1/invitations", "--credential-file", self.f.owner_path,
                              "--save-invitation", invitation_file, body=self.body)
        self.assertEqual(result.returncode, 0, result.stderr)
        creation_output = result.stdout + result.stderr
        secret = json.loads(invitation_file.read_text())["token"]
        self.assertNotIn(secret, creation_output)
        self.assertNotIn(self.f.owner, creation_output)
        claim = {"invitation_token": secret, "handle": "cli_recipient", "claim_nonce": "icn1_" + secrets.token_urlsafe(32)}
        credential_file = self.f.root / "recipient.json"
        result = self.command("POST", "/v1/invitations/claim", "--save-credential", credential_file, body=claim)
        self.assertEqual(result.returncode, 0, result.stderr)
        token = read_credential(credential_file)
        self.assertEqual(self.client.request("GET", "/v1/me", token=token)[1]["role"], "OPERATOR")
        retry_file = self.f.root / "reconciled.json"
        retry = self.command("POST", "/v1/invitations/claim", "--save-credential", retry_file, body=claim)
        self.assertEqual(retry.returncode, 0, retry.stderr)
        self.assertTrue(json.loads(retry.stdout)["result"]["replayed"])
        self.assertEqual(credential_file.read_bytes(), retry_file.read_bytes())
        for value in (secret, claim["claim_nonce"], token, self.f.owner):
            self.assertNotIn(value, result.stdout + result.stderr + retry.stdout + retry.stderr)
        self.assertEqual(len(self.client.request("GET", "/v1/operators", token=self.f.owner)[1]["items"]), 1)
        self.f.store.audit()

    def test_missing_or_existing_output_is_refused_before_issuance(self):
        missing = self.command("POST", "/v1/invitations", "--credential-file", self.f.owner_path, body=self.body)
        self.assertEqual(missing.returncode, 1)
        self.assertEqual(json.loads(missing.stderr)["error"], "INVITATION_OUTPUT_REQUIRED")
        existing = self.f.root / "existing.json"
        existing.write_text("preserved")
        result = self.command("POST", "/v1/invitations", "--credential-file", self.f.owner_path,
                              "--save-invitation", existing, body=self.body)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(existing.read_text(), "preserved")
        self.assertEqual(self.client.request("GET", "/v1/invitations", token=self.f.owner)[1]["items"], [])

    def test_unrecoverable_creation_retry_leaves_no_empty_secret_file(self):
        original = self.f.root / "original.json"
        first = self.command("POST", "/v1/invitations", "--credential-file", self.f.owner_path,
                             "--save-invitation", original, body=self.body)
        self.assertEqual(first.returncode, 0, first.stderr)
        copied = self.f.root / "lost-response.json"
        repeat = self.command("POST", "/v1/invitations", "--credential-file", self.f.owner_path,
                              "--save-invitation", copied, body=self.body)
        self.assertEqual(repeat.returncode, 1)
        self.assertEqual(json.loads(repeat.stderr)["error"], "INVITATION_SECRET_UNAVAILABLE")
        self.assertFalse(copied.exists())
        self.assertEqual(len(self.client.request("GET", "/v1/invitations", token=self.f.owner)[1]["items"]), 1)

    def test_anonymous_claim_still_rejects_cross_origin_transport(self):
        secret = self.client.request("POST", "/v1/invitations", self.body, self.f.owner)[1]["secret"]["token"]
        body = {"invitation_token": secret, "handle": "origin_recipient", "claim_nonce": "icn1_" + secrets.token_urlsafe(32)}
        channel = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        response = None
        try:
            channel.request("POST", "/v1/invitations/claim", canonical(body),
                            {"Content-Type": "application/json", "Origin": "https://other.invalid", "Sec-Fetch-Site": "cross-site"})
            response = channel.getresponse()
            self.assertEqual(response.status, 403)
            self.assertEqual(json.loads(response.read())["error"], "ORIGIN_REJECTED")
        finally:
            if response is not None:
                response.close()
            channel.close()
        self.assertFalse(self.client.request("POST", "/v1/invitations/claim", body)[1]["replayed"])
        self.f.store.audit()
