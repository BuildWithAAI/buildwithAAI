"""Offline HTTP/metadata fixtures. No live provider evidence or bot messages.

Declared-observation fixtures exercise schema acceptance only: matching hashes/labels
cannot independently attest an upstream response. They are never production data.
"""
import copy
import io
import http.client
import json
import shutil
import tempfile
import threading
import unittest
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch
from src.aai_scanner.__main__ import main
from src.aai_scanner.config import Config
from src.aai_scanner.evidence import now, receipt
from src.aai_scanner.http_verification import HTTPProbe, fresh, source_failures, source_issues, verify_http
from src.aai_scanner.release import package_identity
from src.aai_scanner.service import Scanner, report_coverage
from src.aai_scanner.storage import Store
from src.aai_scanner.transport import MAINNET_GENESIS, ProviderError
from tests.scanner_fixtures import ACCOUNT, MINT, FakeMarket, FakeRPC

TOKEN = "synthetic_http_test_1234567890123456"


def declared_rpc(method, slot=100):
    source = receipt("OFFLINE declared response model", "https://rpc.test", method, slot=slot,
                     commitment="finalized", raw_hash="a" * 64)
    source.update(commitment_basis="REQUESTED", classification="OBSERVED")
    if method == "getGenesisHash":
        source["genesis_hash"] = MAINNET_GENESIS
    else:
        source["network_evidence"] = declared_rpc("getGenesisHash", None)
    return source


def report_models():
    store = Store(":memory:")
    try:
        scanner = Scanner(Config(), store, FakeRPC(), FakeMarket())
        token, wallet = scanner.scan(MINT), scanner.wallet(ACCOUNT)
    finally:
        store.close()
    def declared(value):
        if isinstance(value, list):
            return [declared(item) for item in value]
        if not isinstance(value, dict):
            return value
        if "method" in value and "endpoint_host" in value:
            if value["endpoint_host"] == "rpc.test":
                return declared_rpc(value["method"], value.get("slot"))
            source = receipt("OFFLINE declared response model", "https://api.dexscreener.com", "token-pairs", raw_hash="b" * 64)
            source["classification"] = "OBSERVED"
            return source
        return {key: declared(item) for key, item in value.items()}
    return declared(token), declared(wallet)


class LocalServer:
    def __init__(self, responder):
        self.calls = []
        outer = self
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                self.reply()

            def do_POST(self):
                self.reply()

            def reply(self):
                raw = self.rfile.read(int(self.headers.get("Content-Length", "0")))
                outer.calls.append((self.path, self.command, self.headers.get("Authorization"), raw))
                code, data, headers = responder(self.path, self.command, self.headers, raw)
                payload = json.dumps(data).encode() if not isinstance(data, bytes) else data
                self.send_response(code)
                for key, value in {"Content-Type": "application/json", "Cache-Control": "no-store", **headers}.items():
                    self.send_header(key, value)
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                try:
                    self.wfile.write(payload)
                except (BrokenPipeError, ConnectionResetError):
                    pass
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
        self.thread.start()
        self.origin = "http://127.0.0.1:" + str(self.server.server_port)

    def close(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)


class PackageIdentityTests(unittest.TestCase):
    def test_identity_is_stable_and_tracks_code_assets_not_bytecode(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "scanner"
            shutil.copytree(Path(__file__).resolve().parents[1] / "src/aai_scanner", root,
                            ignore=shutil.ignore_patterns("__pycache__"))
            first = package_identity(root)
            self.assertEqual(first["status"], "AVAILABLE")
            self.assertEqual(first["sha256"], package_identity()["sha256"])
            (root / "__pycache__").mkdir()
            (root / "__pycache__/test.pyc").write_bytes(b"not source")
            self.assertEqual(package_identity(root)["sha256"], first["sha256"])
            (root / "static/app.css").write_text("changed bytes")
            self.assertNotEqual(package_identity(root)["sha256"], first["sha256"])

    def test_missing_assets_and_symlinks_do_not_produce_verified_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "__init__.py").write_text("source")
            (root / "static").mkdir()
            for name in ("app.js", "app.css"):
                (root / "static" / name).write_text("asset")
            self.assertEqual(package_identity(root)["status"], "UNVERIFIED")
            (root / "static/index.html").symlink_to(root / "__init__.py")
            self.assertIsNone(package_identity(root)["sha256"])


class HTTPVerificationTests(unittest.TestCase):
    def setUp(self):
        self.token_report, self.wallet_report = report_models()
        self.health = {"status": "AVAILABLE", "scope": "PROCESS_ONLY", "timestamp": now(), "read_only": True,
                       "access_required": True, "release": package_identity()}
        self.ready = {"status": "AVAILABLE", "scope": "LOCAL_APPLICATION", "read_only": True, "execution": "DISABLED",
                      "application_ready": True, "checks": {"local": {"status": "AVAILABLE"}}, "public_launch": "UNVERIFIED"}
        self.overrides = {}
        def responder(path, method, headers, raw):
            if path in self.overrides:
                return self.overrides[path](headers) if callable(self.overrides[path]) else self.overrides[path]
            if path == "/api/health":
                return 200, self.health, {}
            if headers.get("Authorization") != "Bearer " + TOKEN:
                return 401, {"error": "Access required"}, {}
            if path == "/api/ready":
                return 200, self.ready, {}
            if path == "/api/scan":
                self.assertEqual(json.loads(raw), {"mint": MINT, "refresh": True})
                return 200, self.token_report, {}
            if path == "/api/wallet":
                self.assertEqual(json.loads(raw), {"address": ACCOUNT})
                return 200, self.wallet_report, {}
            return 404, {}, {}
        self.server = LocalServer(responder)
        self.addCleanup(self.server.close)
        self.config = replace(Config(), rpc_url="https://rpc.test", public_url=self.server.origin,
                              port=self.server.server.server_port, api_token=TOKEN)

    def verify(self):
        return verify_http(self.config, MINT, ACCOUNT)

    def test_declared_contract_success_is_scoped_and_has_no_public_or_bot_claim(self):
        result = self.verify()
        self.assertEqual(result["status"], "PASSED")
        self.assertEqual(result["public_launch"], "UNVERIFIED")
        self.assertEqual(result["telegram_commands"], "UNVERIFIED")
        self.assertIn("not independently attested", result["note"])
        self.assertNotIn(TOKEN, json.dumps(result))
        self.assertEqual([call[0] for call in self.server.calls], ["/api/health", "/api/ready", "/api/ready", "/api/scan", "/api/wallet"])
        self.assertIsNone(self.server.calls[0][2])
        self.assertIsNone(self.server.calls[1][2])
        self.assertTrue(all(check.get("http", {}).get("raw_sha256", "a" * 64) for check in result["checks"].values()))

    def test_mismatched_release_stops_before_credentials_or_provider_requests(self):
        self.health["release"] = dict(self.health["release"], sha256="0" * 64)
        result = self.verify()
        self.assertEqual(result["status"], "FAILED")
        self.assertEqual(result["checks"]["process"]["error"]["code"], "RELEASE_MISMATCH")
        self.assertEqual(len(self.server.calls), 1)

    def test_unprotected_ready_route_fails_before_scan(self):
        self.overrides["/api/ready"] = (200, self.ready, {})
        result = self.verify()
        self.assertEqual(result["checks"]["authentication"]["status"], "FAILED")
        self.assertEqual(len(self.server.calls), 2)

    def test_rejected_access_token_stops_before_scan(self):
        result = verify_http(replace(self.config, api_token="wrong_http_test_token_12345678901234"), MINT, ACCOUNT)
        self.assertEqual(result["checks"]["application"]["error"]["http_status"], 401)
        self.assertFalse(any(call[0] == "/api/scan" for call in self.server.calls))

    def test_local_no_token_scope_is_explicit(self):
        self.health["access_required"] = False
        for path, data in (("/api/ready", self.ready), ("/api/scan", self.token_report), ("/api/wallet", self.wallet_report)):
            self.overrides[path] = (200, data, {})
        result = verify_http(replace(self.config, api_token=""), MINT, ACCOUNT)
        self.assertEqual(result["status"], "PASSED")
        self.assertEqual(result["checks"]["authentication"]["scope"], "CONFIGURED_LOCAL_NO_TOKEN")

    def test_running_app_without_ready_storage_does_not_pass(self):
        self.ready["checks"]["local"]["status"] = "FAILED"
        result = self.verify()
        self.assertEqual(result["checks"]["application"]["status"], "FAILED")
        self.assertEqual(len(self.server.calls), 3)

    def test_valid_http_with_missing_holders_fails_data_gate_without_fake_success(self):
        self.token_report["holders"].update(status="FAILED", source=None, accounts=[])
        self.token_report["coverage"] = report_coverage(self.token_report)
        result = self.verify()
        self.assertEqual(result["checks"]["application"]["status"], "PASSED")
        self.assertEqual(result["checks"]["token_report"]["status"], "FAILED")
        self.assertEqual(result["checks"]["wallet_report"]["status"], "PASSED")
        self.assertEqual(result["status"], "FAILED")
        self.assertIn("largest_token_accounts", result["checks"]["token_report"]["coverage"]["missing_sections"])

    def test_actual_synthetic_fixture_is_rejected_even_when_all_http_routes_work(self):
        store = Store(":memory:")
        try:
            scanner = Scanner(Config(), store, FakeRPC(), FakeMarket())
            self.token_report = scanner.scan(MINT)
            self.wallet_report = scanner.wallet(ACCOUNT)
        finally:
            store.close()
        result = self.verify()
        self.assertEqual(result["status"], "FAILED")
        self.assertIn("NON_OBSERVED_SOURCE", result["checks"]["token_report"]["sections"]["network"]["issues"])

    def test_wrong_address_stale_report_false_coverage_and_bad_units_cannot_pass(self):
        original = copy.deepcopy(self.token_report)
        for mutation in (lambda r: r.update(mint=ACCOUNT), lambda r: r.update(available_at="2020-01-01T00:00:00+00:00"),
                         lambda r: r["coverage"].update(complete=1), lambda r: r["market"]["price_usd"].update(value=True),
                         lambda r: r["market"]["price_sol"].update(classification="INFERRED")):
            self.token_report = copy.deepcopy(original)
            mutation(self.token_report)
            self.assertEqual(self.verify()["status"], "FAILED")

    def test_wallet_mismatch_and_unavailable_balance_cannot_pass(self):
        self.wallet_report["wallet"] = MINT
        self.assertEqual(self.verify()["checks"]["wallet_report"]["status"], "FAILED")
        self.wallet_report["wallet"] = ACCOUNT
        self.wallet_report["balance_sol"]["value"] = None
        self.assertEqual(self.verify()["checks"]["wallet_report"]["status"], "FAILED")

    def test_secret_bearing_error_bodies_are_never_printed_and_429_stops_requests(self):
        self.overrides["/api/scan"] = (429, {"error": TOKEN, "private": "SECRET_RPC_PATH"}, {"Retry-After": "43"})
        result = self.verify()
        self.assertEqual(result["status"], "FAILED")
        self.assertEqual(result["checks"]["token_report"]["error"]["retry_after_seconds"], 43)
        self.assertNotIn(TOKEN, json.dumps(result))
        self.assertNotIn("SECRET_RPC_PATH", json.dumps(result))
        self.assertFalse(any(call[0] == "/api/wallet" for call in self.server.calls))

    def test_malformed_status_and_timestamp_payloads_do_not_enter_evidence(self):
        self.token_report["mint_info"]["status"] = {"secret": TOKEN}
        self.assertNotIn(TOKEN, json.dumps(self.verify()))
        self.token_report, self.wallet_report = report_models()
        self.token_report["available_at"] = TOKEN
        result = self.verify()
        self.assertIsNone(result["checks"]["token_report"]["server_report_available_at"])
        self.assertNotIn(TOKEN, json.dumps(result))

    def test_invalid_input_and_unsafe_origin_stop_before_network(self):
        for config, mint in ((self.config, "bad"), (replace(self.config, public_url="http://external.test"), MINT)):
            with self.assertRaises(ValueError):
                verify_http(config, mint, ACCOUNT)
        self.assertEqual(self.server.calls, [])

    def test_cli_records_nested_output_and_does_not_open_client_database(self):
        with tempfile.TemporaryDirectory() as folder:
            output, database = Path(folder) / "nested/proof.json", Path(folder) / "must-not-open.sqlite3"
            config = replace(self.config, database=str(database))
            with patch("src.aai_scanner.__main__.Config.from_env", return_value=config), patch("sys.argv", ["scanner", "verify-http", "--mint", MINT, "--wallet", ACCOUNT, "--output", str(output)]), patch("sys.stdout", new_callable=io.StringIO):
                self.assertEqual(main(), 0)
            self.assertEqual(json.loads(output.read_text())["status"], "PASSED")
            self.assertFalse(database.exists())
            self.overrides["/api/scan"] = (500, {"error": TOKEN}, {})
            with patch("src.aai_scanner.__main__.Config.from_env", return_value=config), patch("sys.argv", ["scanner", "verify-http", "--mint", MINT]), patch("sys.stdout", new_callable=io.StringIO):
                self.assertEqual(main(), 1)


class ProbeBoundaryTests(unittest.TestCase):
    def server(self, response):
        server = LocalServer(lambda *args: response)
        self.addCleanup(server.close)
        return server

    def probe(self, server):
        return HTTPProbe(replace(Config(), public_url=server.origin, port=server.server.server_port, api_token=TOKEN))

    def test_actual_redirect_never_forwards_token_to_another_listener(self):
        destination = self.server((200, {}, {}))
        redirect = self.server((302, {}, {"Location": destination.origin + "/api/ready"}))
        with self.assertRaises(ProviderError) as caught:
            self.probe(redirect).request("/api/ready")
        self.assertEqual(caught.exception.code, "REDIRECT_REFUSED")
        self.assertEqual(redirect.calls[0][2], "Bearer " + TOKEN)
        self.assertEqual(destination.calls, [])

    def test_non_json_non_finite_oversized_and_non_object_responses_are_rejected(self):
        for response in ((200, {}, {"Content-Type": "text/html"}), (200, b"{\"value\":NaN}", {}),
                         (200, b"[1,2]", {}), (200, b"x" * 2_000_001, {})):
            with self.subTest(size=len(response[1]) if isinstance(response[1], bytes) else 0):
                with self.assertRaises(ProviderError):
                    self.probe(self.server(response)).request("/api/ready")

    def test_expired_budget_and_unknown_routes_do_not_send_requests(self):
        server = self.server((200, {}, {}))
        probe = self.probe(server)
        with self.assertRaises(ValueError):
            probe.request("/api/execute")
        probe.deadline = 0
        with self.assertRaises(ProviderError):
            probe.request("/api/health")
        self.assertEqual(server.calls, [])

    def test_malformed_http_status_line_becomes_safe_connection_failure(self):
        server = self.server((200, {}, {}))
        with patch("src.aai_scanner.http_verification.urllib.request.build_opener") as opener:
            opener.return_value.open.side_effect = http.client.BadStatusLine(TOKEN)
            with self.assertRaises(ProviderError) as caught:
                self.probe(server).request("/api/health")
        self.assertEqual(caught.exception.code, "CONNECTION_FAILED")
        self.assertNotIn(TOKEN, str(caught.exception))
        self.assertEqual(server.calls, [])

    def test_503_closes_response_and_blocks_further_requests(self):
        server = self.server((503, {}, {"Retry-After": "11"}))
        probe = self.probe(server)
        self.assertEqual(probe.request("/api/ready")[1]["retry_after_seconds"], 11)
        with self.assertRaises(ProviderError):
            probe.request("/api/health")
        self.assertEqual(len(server.calls), 1)

    def test_source_units_identity_finality_hash_and_age_are_checked(self):
        config = replace(Config(), rpc_url="https://rpc.test")
        original = declared_rpc("getBalance")
        self.assertEqual(source_issues(original, config, "getBalance", True), [])
        for changes, code in (({"slot": True}, "SLOT_UNVERIFIED"), ({"raw_sha256": None}, "SOURCE_HASH_UNVERIFIED"),
                              ({"endpoint_host": "unapproved.test"}, "UNEXPECTED_SOURCE_HOST"),
                              ({"commitment_basis": "ASSUMED"}, "FINALITY_REQUEST_UNVERIFIED"),
                              ({"available_at": "2020-01-01T00:00:00+00:00"}, "SOURCE_NOT_FRESH")):
            self.assertIn(code, source_issues(dict(original, **changes), config, "getBalance", True))
        bad = copy.deepcopy(original)
        bad["network_evidence"]["genesis_hash"] = "wrong network"
        self.assertIn("MAINNET_UNVERIFIED", source_issues(bad, config, "getBalance", True))
        self.assertEqual(source_issues([[[original]]], config), ["INVALID_SOURCE_COLLECTION"])
        for stamp in (None, TOKEN, "2026-10-08T00:00:00", (datetime.now(timezone.utc) + timedelta(seconds=30)).isoformat()):
            self.assertFalse(fresh(stamp))

    def test_provider_failure_receipts_keep_typed_codes_without_secret_paths_or_messages(self):
        config = replace(Config(), rpc_url="https://rpc.test/SECRET_RPC_PATH?token=private")
        source = {"endpoint_host": "rpc.test", "error": {"code": "HTTP_ERROR", "http_status": 429,
                  "retry_after_seconds": 10, "reason": TOKEN, "url": config.rpc_url,
                  "attempts": [{"endpoint_host": "rpc.test", "code": "HTTP_ERROR", "http_status": 429, "retry_after_seconds": 10},
                               {"endpoint_host": "secret.test", "code": TOKEN, "http_status": True}]}}
        failures = source_failures(source, config)
        self.assertEqual(failures, [{"endpoint_host": "rpc.test", "code": "HTTP_ERROR", "http_status": 429, "retry_after_seconds": 10}])
        self.assertNotIn(TOKEN, json.dumps(failures))
        self.assertNotIn("SECRET_RPC_PATH", json.dumps(failures))
        source["error"].update(attempts=[], code=TOKEN, http_status=True, retry_after_seconds=True)
        self.assertEqual(source_failures(source, config)[0]["code"], "UNVERIFIED_ERROR")
        self.assertIsNone(source_failures(source, config)[0]["http_status"])
