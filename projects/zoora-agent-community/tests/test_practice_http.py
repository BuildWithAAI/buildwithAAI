"""Real Waitress HTTP, strict origin checks and authenticated paper settlement."""

import http.client
import json
import secrets
import shutil
import threading
import unittest

from helpers import Fixture
from zoora_community.wsgi_server import WSGIServer
from zoora_community.http_app import ASSETS
from zoora_community.operations import ROOT, package_snapshot


class PracticeHTTPTests(unittest.TestCase):
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

    def request(self, method, path, body=None, token=None, origin=None):
        headers = {}
        if token:
            headers["Authorization"] = "Bearer " + token
        if origin:
            headers["Origin"] = origin
        if body is not None:
            headers["Content-Type"] = "application/json"
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        try:
            connection.request(
                method, path, json.dumps(body) if body is not None else None, headers
            )
            response = connection.getresponse()
            raw = response.read()
            data = (
                json.loads(raw)
                if response.getheader("Content-Type", "").startswith("application/json")
                else raw
            )
            return response.status, data, dict(response.getheaders())
        finally:
            connection.close()

    def test_package_pin_covers_new_migration_and_alias_uses_identical_bytes(self):
        root = self.f.root / "package"
        (root / "zoora_community").mkdir(parents=True)
        (root / "web").mkdir()
        for source in (ROOT / "zoora_community").glob("*"):
            if source.suffix in (".py", ".sql"):
                shutil.copyfile(source, root / "zoora_community" / source.name)
        shutil.copyfile(ROOT / "requirements.lock", root / "requirements.lock")
        for name, _ in set(ASSETS.values()):
            shutil.copyfile(ROOT / "web" / name, root / "web" / name)
        before, assets = package_snapshot(root)
        self.assertEqual(assets["/practice"], assets["/"])
        for version in (8, 9):
            target = root / "zoora_community" / f"migration_{version:03}.sql"
            target.write_text(
                target.read_text(encoding="utf-8") + "\n-- package-pin test\n", encoding="utf-8"
            )
            after, _ = package_snapshot(root)
            self.assertNotEqual(before, after)
            before = after

    def test_page_and_assets_have_csp_and_no_future_state(self):
        for path in ("/practice", "/market.js"):
            status, source, headers = self.request("GET", path)
            self.assertEqual(status, 200)
            self.assertIn("default-src 'none'", headers["Content-Security-Policy"])
            self.assertEqual(headers["Cache-Control"], "no-store")
            for forbidden in (
                b"initial_json",
                b"state_json",
                b"liquidity_exit",
                b"innerHTML",
                b"eval(",
            ):
                self.assertNotIn(forbidden, source)
        self.assertEqual(self.request("GET", "/v1/practice/episodes")[0], 401)
        self.assertEqual(
            self.request(
                "GET", "/v1/practice/episodes", token=self.agent, origin="https://attacker.example"
            )[0],
            403,
        )

    def test_real_http_enrollment_order_fill_and_retry_no_double_debit(self):
        def new_id():
            return secrets.token_hex(16)

        status, episode, _ = self.request(
            "POST", "/v1/practice/episodes", {"request_id": new_id()}, self.f.owner
        )
        self.assertEqual(status, 201)
        base = "/v1/practice/episodes/" + episode["id"]
        self.assertEqual(
            self.request(
                "POST",
                base + "/accounts",
                {
                    "request_id": new_id(),
                    "agent_id": self.agent_id,
                    "model_pipeline_sha256": "a" * 64,
                },
                self.operator,
            )[0],
            201,
        )
        _, view, _ = self.request("GET", base, token=self.agent)
        payload = {
            "request_id": new_id(),
            "coin_id": view["market"]["coins"][0]["id"],
            "side": "BUY",
            "amount": 1_000_000,
            "min_output": 1,
            "observation_tick": 0,
        }
        _, accepted, _ = self.request("POST", base + "/orders", payload, self.agent)
        self.assertEqual(accepted["state"], "PENDING")
        self.assertEqual(self.request("POST", base + "/orders", payload, self.agent)[1], accepted)
        self.assertEqual(
            self.request(
                "POST", base + "/step", {"request_id": new_id(), "expected_tick": 0}, self.agent
            )[0],
            403,
        )
        self.assertEqual(
            self.request(
                "POST", base + "/step", {"request_id": new_id(), "expected_tick": 0}, self.f.owner
            )[0],
            201,
        )
        _, account, _ = self.request(
            "GET", base + "/accounts/" + self.agent_id, token=self.operator
        )
        self.assertEqual((account["gas_micro"], account["order_count"]), (1000, 1))
        self.assertEqual(account["recent_receipts"][0]["state"], "FILLED")
        self.assertFalse(account["live_execution_allowed"])
        self.assertEqual(
            self.request("GET", base + "/history?after=" + "a" * 32, token=self.agent)[0], 200
        )
        self.f.store.audit()
