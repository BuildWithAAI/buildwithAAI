"""Actual private-pilot HTTP acceptance, not only in-process dispatch."""

import http.client
import json
import threading
import unittest

from helpers import Fixture, address, signed_body
from zoora_community.wsgi_server import WSGIServer


class ForumHTTPTests(unittest.TestCase):
    def setUp(self):
        self.f = Fixture(real_time=True)
        self.addCleanup(self.f.close)
        self.f.store.private_pilot = True
        _, self.operator = self.f.operator()
        self.agent_id, self.agent = self.f.agent(self.operator)
        self.server = WSGIServer(self.f.store, 0)
        self.thread = threading.Thread(target=self.server.serve_forever)
        self.thread.start()
        self.addCleanup(self.stop)

    def stop(self):
        self.server.shutdown()
        self.thread.join(10)
        self.assertFalse(self.thread.is_alive())

    def request(self, method, path, body=None, token=None, origin=None, content_type="application/json"):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        headers = {}
        if token:
            headers["Authorization"] = "Bearer " + token
        if origin:
            headers["Origin"] = origin
        if body is not None:
            headers["Content-Type"] = content_type
        try:
            connection.request(method, path, json.dumps(body) if body is not None else None, headers)
            response = connection.getresponse()
            raw = response.read()
            data = json.loads(raw) if response.getheader("Content-Type", "").startswith("application/json") else raw
            return response.status, data, dict(response.getheaders())
        finally:
            connection.close()

    def test_origin_bound_creator_login_and_private_posting_only_access(self):
        status, challenge, _ = self.request("POST", "/v1/creator/wallet/link-challenges", {"wallet": address("creator")}, self.operator)
        self.assertEqual(status, 201)
        self.assertEqual(challenge["audience"], f"http://127.0.0.1:{self.server.server_port}")
        self.assertEqual(self.request("POST", "/v1/creator/wallet/link", signed_body(challenge, "creator"), self.operator)[0], 201)
        _, challenge, _ = self.request("POST", "/v1/creator/wallet/login/challenges", {"wallet": address("creator")})
        _, logged_in, _ = self.request("POST", "/v1/creator/wallet/login", signed_body(challenge, "creator"))
        self.assertEqual(logged_in["credential"]["role"], "OPERATOR")
        _, posting, _ = self.request("POST", f"/v1/forum/agents/{self.agent_id}/credentials", {}, self.operator)
        token = posting["token"]
        self.assertEqual(self.request("GET", "/v1/forum/topics")[0], 401)
        self.assertEqual(self.request("GET", "/v1/forum/topics", token=token)[0], 200)
        self.assertEqual(self.request("GET", "/v1/jobs", token=token)[0], 403)
        payload = {"topic": "crypto", "title": "Independent signals", "body": "No execution authority is granted by a post."}
        status, thread, headers = self.request("POST", "/v1/forum/threads", payload, token)
        self.assertEqual(status, 201)
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertIn("default-src 'none'", headers["Content-Security-Policy"])
        self.assertEqual(self.request("GET", f"/v1/forum/threads/{thread['id']}", token=token)[0], 200)
        self.assertEqual(self.request("POST", "/v1/forum/threads", payload, token, "https://attacker.example")[0], 403)
        self.assertEqual(self.request("POST", "/v1/forum/threads", payload, token, content_type="multipart/form-data")[0], 415)
        self.assertEqual(self.request("POST", "/v1/forum/uploads", {}, token)[0], 404)
        self.assertEqual(self.request("GET", "/v1/forum/downloads", token=token)[0], 404)
        self.f.store.audit()

    def test_forum_asset_is_self_hosted_plain_text_dom(self):
        status, source, headers = self.request("GET", "/forum.js")
        self.assertEqual(status, 200)
        self.assertIn(b"textContent", source)
        for sink in (b"innerHTML", b"outerHTML", b"eval(", b"createObjectURL", b"createElement(\"a\""):
            self.assertNotIn(sink, source)
        self.assertEqual(headers["X-Content-Type-Options"], "nosniff")
