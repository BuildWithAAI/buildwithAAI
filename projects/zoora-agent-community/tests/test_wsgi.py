"""Repeat existing wire/security contracts against the actual production adapter."""

import hashlib
import json
import socket
import threading
import time
from unittest.mock import patch

from helpers import Fixture
import test_http as legacy
from zoora_community.client import Client
from zoora_community.validation import Problem
from zoora_community.wsgi_server import WSGIServer


class WSGITests(legacy.HttpTests):
    def setUp(self):
        self.f = Fixture()
        self.addCleanup(self.f.close)
        _, self.operator = self.f.operator()
        self.agent_id, self.agent = self.f.agent(self.operator)
        self.server = WSGIServer(self.f.store, 0)
        self.thread = threading.Thread(target=self.server.serve_forever)
        self.thread.start()
        self.addCleanup(self.stop)
        self.client = Client(self.server.server_port)

    def stop(self):
        self.server.shutdown()
        self.thread.join(timeout=10)
        self.assertFalse(self.thread.is_alive())
        self.assertFalse(self.server.channels)
        self.assertFalse(self.server.server.task_dispatcher.threads)

    def raw(self, request):
        request = request.replace(b"\r\n\r\n", b"\r\nConnection: close\r\n\r\n", 1)
        with socket.create_connection(self.server.server_address, timeout=5) as connection:
            connection.sendall(request)
            result = b""
            while True:
                try:
                    part = connection.recv(65536)
                except ConnectionResetError:
                    break  # The parser may close with unread oversized input.
                if not part:
                    break
                result += part
            return result

    def test_readiness_authorization_rollback_and_minimal_liveness(self):
        self.assertEqual(json.loads(self.request("GET", "/healthz")[2]),
                         {"status": "AVAILABLE", "scope": "PROCESS_LIVENESS"})
        before = hashlib.sha256(self.f.store.path.read_bytes()).hexdigest()
        audit = self.f.store.audit()
        for token, expected in ((None, 401), (self.agent, 403), (self.operator, 200), (self.f.owner, 200)):
            headers = {"Authorization": "Bearer " + token} if token else {}
            status, _, payload = self.request("GET", "/v1/ready", headers=headers)
            self.assertEqual(status, expected)
            self.assertNotIn(self.agent.encode(), payload)
            self.assertNotIn(self.operator.encode(), payload)
            if status == 200:
                report = json.loads(payload)
                self.assertEqual(report["checks"]["database_write_rollback"], "AVAILABLE")
                self.assertEqual(report["public_launch"], "UNVERIFIED")
                self.assertEqual(report["external_rpc"], "UNVERIFIED")
                self.assertEqual(report["transport"], "WAITRESS_3_0_2")
        self.assertEqual(hashlib.sha256(self.f.store.path.read_bytes()).hexdigest(), before)
        self.assertEqual(self.f.store.audit(), audit)

    def test_untrusted_forwarding_headers_cannot_rewrite_host_or_origin(self):
        headers = {"Host": "evil.example", "X-Forwarded-Host": self.server.host,
                   "X-Forwarded-Proto": "http", "Forwarded": 'host="' + self.server.host + '"'}
        self.assertEqual(self.request("GET", "/v1/status", headers=headers)[0], 403)

    def test_exact_request_body_bound_is_accepted_and_one_more_is_rejected(self):
        headers = {"Content-Type": "application/json", "Authorization": "Bearer " + self.agent}
        body = '{"body":"boundary"}'
        body += " " * (16384 - len(body))
        self.assertEqual(self.request("POST", "/v1/posts", body, headers)[0], 201)
        self.assertEqual(self.request("POST", "/v1/posts", body + " ", headers)[0], 413)
        headers = {"Origin": "https://evil.example", "X-Forwarded-Host": self.server.host}
        self.assertEqual(self.request("GET", "/v1/status", headers=headers)[0], 403)

    def test_ambiguous_framing_pipeline_cannot_create_a_post(self):
        host = self.server.host.encode()
        authorization = b"Authorization: Bearer " + self.agent.encode() + b"\r\n"
        prefix = b"POST /v1/posts HTTP/1.1\r\nHost: " + host + b"\r\n" + authorization + b"Content-Type: application/json\r\n"
        for extra, body in [(b"Content-Length: 2\r\nTransfer-Encoding: chunked\r\n", b"0\r\n\r\n"),
                            (b"Transfer-Encoding: chunked\r\n", b"2\r\n{}\r\n0\r\n\r\n"),
                            (b"Content-Length: 2\r\nExpect: 100-continue\r\n", b"{}")]:
            payload = prefix + extra + b"\r\n" + body
            payload += prefix + b"Content-Length: 17\r\n\r\n{\"body\":\"hidden\"}"
            raw = self.raw(payload)
            self.assertNotIn(b" 201 ", raw)
            self.assertNotIn(self.agent.encode(), raw)
        self.assertEqual(self.client.request("GET", "/v1/status")[1]["counts"]["posts"], 0)

    def test_header_limit_and_partial_body_timeout_do_not_block_health(self):
        payload = b"GET /v1/status HTTP/1.1\r\nHost: " + self.server.host.encode()
        payload += b"\r\nX-Large: " + b"a" * 9000 + b"\r\n\r\n"
        self.assertIn(b" 431 ", self.raw(payload).split(b"\r\n")[0])
        with socket.create_connection(self.server.server_address, timeout=9) as connection:
            connection.sendall(b"POST /v1/posts HTTP/1.1\r\nHost: " + self.server.host.encode() +
                               b"\r\nContent-Length: 12\r\nContent-Type: application/json\r\n\r\n{")
            self.assertEqual(self.request("GET", "/healthz")[0], 200)
            started = time.monotonic()
            self.assertEqual(connection.recv(1), b"")
            self.assertLess(time.monotonic() - started, 8)

    def test_storage_failure_fails_readiness_but_liveness_and_assets_survive(self):
        with patch.object(self.f.store, "storage_probe", side_effect=Problem(503, "STORAGE_UNAVAILABLE")):
            status, _, payload = self.request("GET", "/v1/ready", headers={"Authorization": "Bearer " + self.operator})
            self.assertEqual(status, 503)
            self.assertEqual(json.loads(payload)["error"], "STORAGE_UNAVAILABLE")
            self.assertEqual(self.request("GET", "/healthz")[0], 200)
            self.assertEqual(self.request("GET", "/")[0], 200)

    def test_telemetry_has_only_bounded_aggregate_fields(self):
        self.request("GET", "/v1/me?token=" + self.agent)
        report = self.client.request("GET", "/v1/ready", token=self.operator)[1]
        self.assertGreaterEqual(report["metrics"]["completed"], 1)
        self.assertGreaterEqual(report["metrics"]["status_counts"]["4xx"], 1)
        self.assertNotIn(self.agent, json.dumps(report))
        self.assertEqual(set(report["metrics"]), {"active", "peak_active", "completed", "status_counts", "total_application_ms", "max_application_ms"})
