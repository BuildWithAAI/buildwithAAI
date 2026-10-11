import http.client
import json
import socket
import threading
import unittest
from unittest.mock import patch

from helpers import Fixture, address, signed_body
from zoora_community.client import Client
from zoora_community.server import LocalServer
from zoora_community.validation import Problem


class HttpTests(unittest.TestCase):
    def setUp(self):
        self.f = Fixture()
        self.addCleanup(self.f.close)
        _, self.operator = self.f.operator()
        self.agent_id, self.agent = self.f.agent(self.operator)
        self.server = LocalServer(self.f.store, 0)
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.01})
        self.thread.start()
        self.addCleanup(self.stop)
        self.client = Client(self.server.server_port)

    def stop(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)
        self.assertFalse(self.thread.is_alive())

    def raw(self, request):
        with socket.create_connection(self.server.server_address, timeout=5) as connection:
            connection.sendall(request)
            result = b""
            while True:
                part = connection.recv(65536)
                if not part:
                    break
                result += part
            return result

    def request(self, method, path, body=None, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=6)
        try:
            connection.request(method, path, body, headers or {})
            response = connection.getresponse()
            return response.status, response.headers, response.read()
        finally:
            connection.close()

    def test_actual_http_authenticated_post_and_persistent_author(self):
        status, result = self.client.request("POST", "/v1/posts", {"body": "authored"}, self.agent)
        self.assertEqual(status, 201)
        self.assertEqual(result["author_id"], self.agent_id)
        self.assertEqual(self.client.request("GET", "/v1/posts/" + result["id"])[1]["body"], "authored")

    def test_actual_http_proof_registration_and_replay_rejection(self):
        challenge = self.client.request("POST", "/v1/wallet/challenges", {"handle": "http_wallet",
            "wallet": address("http_wallet"), "capabilities": ["research"]}, self.operator)[1]
        body = signed_body(challenge, "http_wallet")
        result = self.client.request("POST", "/v1/agents", body, self.operator)[1]
        proof = self.client.request("GET", "/v1/agents/" + result["agent"]["id"] + "/wallet-proof")[1]
        self.assertEqual(proof["status"], "SIGNATURE_VERIFIED")
        with self.assertRaises(Problem) as rejected:
            self.client.request("POST", "/v1/agents", body, self.operator)
        self.assertEqual(rejected.exception.code, "CHALLENGE_CONSUMED")

    def test_actual_http_observation_evidence_and_invalid_routes(self):
        from test_solana_rpc import FixtureRPC, SIGNATURE
        self.f.store.rpc = FixtureRPC()
        route = "/v1/agents/" + self.agent_id + "/transactions"
        result = self.client.request("POST", route, {"network": "solana:devnet", "signature": SIGNATURE}, self.agent)[1]
        detail = self.client.request("GET", "/v1/transactions/" + result["id"])[1]
        self.assertIsInstance(detail["raw_rpc_json"], str)
        self.assertEqual(detail["report"]["slot"], "18446744073709551615")
        for path in (route + "/", route.replace("/v1/", "/v1//")):
            with self.assertRaises(Problem):
                self.client.request("POST", path, {"network": "solana:devnet", "signature": SIGNATURE}, self.agent)
        self.assertEqual(len(self.f.store.call("GET", "/v1/transactions")[1]["items"]), 1)

    def test_anonymous_reads_and_private_credential_audit_routes(self):
        self.assertEqual(self.client.request("GET", "/v1/agents")[0], 200)
        for path in ("/v1/me", "/v1/audit"):
            status, headers, body = self.request("GET", path)
            self.assertEqual(status, 401)
            self.assertEqual(headers["WWW-Authenticate"], "Bearer")
            self.assertNotIn(self.agent.encode(), body)

    def test_host_and_origin_rebinding_rejected(self):
        for headers in ({"Host": "attacker.example"}, {"Origin": "https://attacker.example"}, {"Origin": "null"}, {"Sec-Fetch-Site": "cross-site"}):
            self.assertEqual(self.request("GET", "/v1/status", headers=headers)[0], 403)
        self.assertEqual(self.request("GET", "/v1/status", headers={"Origin": self.server.origin})[0], 200)

    def test_json_framing_duplicate_headers_and_size_limits(self):
        host = self.server.host.encode()
        headers = b"Host: " + host + b"\r\n"
        payloads = [
            b"POST /v1/posts HTTP/1.1\r\n" + headers + b"Content-Length: 2\r\nContent-Length: 2\r\n\r\n{}",
            b"POST /v1/posts HTTP/1.1\r\n" + headers + b"Transfer-Encoding: chunked\r\n\r\n0\r\n\r\n",
            b"GET /v1/me HTTP/1.1\r\n" + headers + b"Authorization: Bearer x\r\nAuthorization: Bearer y\r\n\r\n",
            b"GET /v1/status HTTP/1.1\r\n" + headers + headers + b"\r\n",
        ]
        for payload in payloads:
            self.assertNotIn(b" 200 ", self.raw(payload).split(b"\r\n")[0])
        self.assertEqual(self.request("POST", "/v1/posts", "x", {"Content-Type": "text/plain"})[0], 415)
        self.assertEqual(self.request("POST", "/v1/posts", "x" * 16385, {"Content-Type": "application/json"})[0], 413)
        self.assertEqual(self.request("GET", "/v1/status", "{}", {"Content-Length": "2"})[0], 400)

    def test_duplicate_json_unknown_fields_and_tokens_in_query_rejected(self):
        headers = {"Content-Type": "application/json", "Authorization": "Bearer " + self.agent}
        self.assertEqual(self.request("POST", "/v1/posts", '{"body":"a","body":"b"}', headers)[0], 400)
        self.assertEqual(self.request("POST", "/v1/posts", '{"body":"a","author_id":"fake"}', headers)[0], 400)
        status, _, raw = self.request("GET", "/v1/me?token=" + self.agent)
        self.assertEqual(status, 400)
        self.assertNotIn(self.agent.encode(), raw)

    def test_security_headers_and_assets_have_no_external_dependencies(self):
        for path in ("/", "/app.js", "/style.css", "/v1/status"):
            status, headers, _ = self.request("GET", path)
            self.assertEqual(status, 200)
            self.assertEqual(headers["Cache-Control"], "no-store")
            self.assertEqual(headers["X-Content-Type-Options"], "nosniff")
            self.assertIn("connect-src 'self'", headers["Content-Security-Policy"])
            self.assertIn("frame-ancestors 'none'", headers["Content-Security-Policy"])
            self.assertNotIn("Access-Control-Allow-Origin", headers)

    def test_path_traversal_absolute_url_and_invalid_pagination(self):
        for path in ("/../schema.sql", "/%2e%2e/schema.sql", "http://attacker.example/v1/status", "//attacker.example/x", "/v1/agents?limit=5000", "/v1/agents?limit=1&limit=2", "/v1/agents?after=bad"):
            self.assertGreaterEqual(self.request("GET", path)[0], 400)

    def test_unsupported_methods_and_no_http_recovery_or_execution(self):
        self.assertEqual(self.request("DELETE", "/v1/agents")[0], 405)
        for path in ("/v1/recover-owner", "/v1/payments", "/v1/trades"):
            with self.assertRaises(Problem) as caught:
                self.client.request("POST", path, {}, self.agent)
            self.assertEqual(caught.exception.status, 404)

    def test_redacted_storage_failure_and_no_partial_write(self):
        with patch.object(self.f.store, "_event", side_effect=RuntimeError("secret " + self.agent)):
            status, _, payload = self.request("POST", "/v1/posts", '{"body":"failed"}', {"Content-Type": "application/json", "Authorization": "Bearer " + self.agent})
        self.assertEqual(status, 503)
        self.assertEqual(json.loads(payload), {"error": "SERVICE_UNAVAILABLE"})
        self.assertNotIn(self.agent.encode(), payload)
        self.assertEqual(self.client.request("GET", "/v1/status")[1]["counts"]["posts"], 0)

    def test_successful_post_rate_returns_retry_header(self):
        for _ in range(6):
            self.client.request("POST", "/v1/posts", {"body": "bounded"}, self.agent)
        status, headers, payload = self.request("POST", "/v1/posts", '{"body":"refused"}', {"Content-Type": "application/json", "Authorization": "Bearer " + self.agent})
        self.assertEqual(status, 429)
        self.assertEqual(headers["Retry-After"], "60")
        self.assertEqual(json.loads(payload)["error"], "POST_RATE_LIMIT")


if __name__ == "__main__":
    unittest.main()
