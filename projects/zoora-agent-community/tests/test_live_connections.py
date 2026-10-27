"""Transport/auth regressions. All responses here are TEST DATA, never live evidence."""

from contextlib import redirect_stderr, redirect_stdout
import hashlib
import http.client
import io
import json
import os
from pathlib import Path
import socket
import ssl
import sys
import tempfile
import unittest
from unittest.mock import patch

from zoora_community import live_connections as live
from zoora_community.validation import Problem, canonical

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from bridge_fixture import CERT, ProviderFixture, customer  # noqa: E402

KEY = "PUBLIC-TEST-ONLY-NOT-A-REAL-PRODUCTION-KEY"
ADDRESS = "11111111111111111111111111111111"
CUSTOMER = "00000000-0000-0000-0000-000000000001"


class LiveConnectionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        self.key = self.folder / "provider.key"
        self.key.write_text(KEY + "\n")
        self.key.chmod(0o600)

    def rejected(self, code, fn):
        with self.assertRaises(Problem) as caught:
            fn()
        self.assertEqual(caught.exception.code, code)

    def test_private_secret_is_not_echoed_or_accepted_for_wrong_environment(self):
        self.assertEqual(live.read_api_key(self.key, "production"), KEY)
        self.rejected("BRIDGE_SANDBOX_KEY_REQUIRED", lambda: live.read_api_key(self.key, "sandbox"))
        self.key.write_text("sk-test-PUBLIC-TEST-KEY-NEVER-FUND")
        self.rejected("CONNECTION_TEST_KEY_ON_PRODUCTION", lambda: live.read_api_key(self.key, "production"))

    def test_secret_header_injection_empty_and_oversized_files_are_rejected(self):
        for key in ("", "x" * 259, KEY + "\n\rInjected: yes", KEY + "\n\n", KEY + "\x00"):
            with self.subTest(length=len(key)):
                self.key.write_text(key)
                with self.assertRaises(Problem):
                    live.read_api_key(self.key, "production")

    @unittest.skipUnless(os.name == "posix", "POSIX mode and symlink protection")
    def test_secret_symlink_and_group_readability_fail_before_network(self):
        link = self.folder / "link.key"
        link.symlink_to(self.key)
        self.rejected("CONNECTION_UNSAFE_KEY_FILE", lambda: live.read_api_key(link, "production"))
        self.key.chmod(0o640)
        self.rejected("CONNECTION_UNSAFE_KEY_FILE", lambda: live.read_api_key(self.key, "production"))

    def test_all_payment_mutations_and_arbitrary_hosts_paths_fail_before_http(self):
        attempts = [
            ("evil.example", "GET", "/v0/customers/" + CUSTOMER, {}),
            (live.BRIDGE_HOSTS["production"], "POST", "/v0/transfers", {"api_key": KEY}),
            (live.BRIDGE_HOSTS["production"], "GET", "/v0/customers/" + CUSTOMER + "?x=1", {"api_key": KEY}),
            (live.BRIDGE_HOSTS["production"], "GET", "/v0/customers/" + CUSTOMER, {"api_key": KEY, "payload": {}}),
            (live.NETWORKS["solana:mainnet"][0], "POST", "/", {"payload": {
                "jsonrpc": "2.0", "id": 1, "method": "sendTransaction", "params": ["payload"]}}),
        ]
        with patch.object(live, "HTTPSConnection") as connection:
            for host, method, path, options in attempts:
                with self.subTest(host=host, method=method, path=path), self.assertRaises(Problem):
                    live.request_json(host, method, path, **options)
            connection.assert_not_called()

    def test_test_key_cannot_reach_production_even_through_low_level_transport(self):
        with patch.object(live, "HTTPSConnection") as connection:
            self.rejected("CONNECTION_TEST_KEY_ON_PRODUCTION", lambda: live.request_json(
                live.BRIDGE_HOSTS["production"], "GET", "/v0/customers/" + CUSTOMER,
                api_key="sk-test-PUBLIC-TEST-KEY-NEVER-FUND"))
            connection.assert_not_called()

    def rpc(self, values):
        answers = [({"jsonrpc": "2.0", "id": 1, "result": value}, "a" * 64) for value in values]
        return patch.object(live, "request_json", side_effect=answers)

    def test_real_read_shape_keeps_large_native_amount_exact_and_does_not_claim_ownership(self):
        with self.rpc([live.NETWORKS["solana:mainnet"][1], 100,
                       {"context": {"slot": 101}, "value": 2**64 - 1}]) as requests:
            result = live.solana_read("solana:mainnet", ADDRESS)
        self.assertEqual(result["native_balance"]["lamports"], "18446744073709551615")
        self.assertFalse(result["wallet_control_verified"])
        self.assertFalse(result["token_balances_verified"])
        self.assertEqual(result["pnl"], "UNAVAILABLE")
        self.assertEqual([x.kwargs["payload"]["method"] for x in requests.call_args_list],
                         ["getGenesisHash", "getSlot", "getBalance"])

    def test_wrong_genesis_stops_before_balance_request(self):
        with self.rpc(["wrong-cluster"]) as requests:
            self.rejected("CONNECTION_WRONG_SOLANA_CLUSTER", lambda: live.solana_read("solana:mainnet", ADDRESS))
        self.assertEqual(requests.call_count, 1)

    def test_rpc_error_wrong_id_boolean_id_and_missing_result_are_refused(self):
        invalid = [
            {"jsonrpc": "2.0", "id": 1, "error": {"message": KEY}},
            {"jsonrpc": "2.0", "id": True, "result": "x"},
            {"jsonrpc": "2.0", "id": 2, "result": "x"},
            {"jsonrpc": "2.0", "id": 1},
        ]
        for value in invalid:
            with patch.object(live, "request_json", return_value=(value, "a" * 64)):
                self.rejected("CONNECTION_RPC_RESPONSE_REJECTED", lambda: live.solana_read("solana:mainnet"))

    def test_slot_regression_and_noninteger_balance_are_rejected(self):
        for value in ({"context": {"slot": 99}, "value": 0},
                      {"context": {"slot": 101}, "value": True},
                      {"context": {"slot": 101}, "value": -1}):
            with self.rpc([live.NETWORKS["solana:mainnet"][1], 100, value]), self.assertRaises(Problem):
                live.solana_read("solana:mainnet", ADDRESS)

    def test_bad_wallet_refused_before_rpc(self):
        with patch.object(live, "request_json") as request:
            self.rejected("INVALID_WALLET_ADDRESS", lambda: live.solana_read("solana:mainnet", "not-an-address"))
            request.assert_not_called()

    def test_production_account_projection_redacts_personal_fields(self):
        with patch.object(live, "request_json", return_value=(customer(), "b" * 64)) as request:
            result = live.bridge_read("production", CUSTOMER, self.key)
        self.assertEqual(request.call_args.args, ("api.bridge.xyz", "GET", "/v0/customers/" + CUSTOMER))
        self.assertTrue(result["account_read_verified"])
        self.assertFalse(result["payment_execution_ready"])
        self.assertFalse(result["solana_usdc_route_verified"])
        for secret in (KEY, "PRIVATE", "email", "first_name"):
            self.assertNotIn(secret, canonical(result))

    def test_customer_mismatch_is_not_a_successful_connection(self):
        with patch.object(live, "request_json", return_value=({**customer(), "id": "bad"}, "b" * 64)):
            self.rejected("BRIDGE_CUSTOMER_RESPONSE_REJECTED", lambda: live.bridge_read("production", CUSTOMER, self.key))

    def cli(self, args):
        output, errors = io.StringIO(), io.StringIO()
        with patch.object(sys, "argv", ["connections", *map(str, args)]), redirect_stdout(output), redirect_stderr(errors):
            result = live.main()
        return result, output.getvalue(), errors.getvalue()

    def test_network_failure_saves_blocked_report_and_never_fills_sample_values(self):
        path = self.folder / "connection.json"
        with patch.object(live, "request_json", side_effect=Problem(502, "CONNECTION_DNS_FAILED")):
            code, text, errors = self.cli(["solana", "--out", path])
        saved = json.loads(path.read_text())
        self.assertEqual((code, errors, saved["state"]), (2, "", "BLOCKED"))
        self.assertEqual(json.loads(text), saved)
        self.assertIsNone(saved["observation"])
        self.assertFalse(saved["fixture_fallback"])
        self.assertFalse(saved["live_launch_ready"])
        self.assertEqual(saved["payment_writes"], 0)

    def test_existing_report_refused_before_network(self):
        path = self.folder / "connection.json"
        path.write_text("retained")
        with patch.object(live, "request_json") as request:
            code, _text, _errors = self.cli(["solana", "--out", path])
            request.assert_not_called()
        self.assertEqual(code, 1)
        self.assertEqual(path.read_text(), "retained")

    def test_readable_but_incomplete_customer_does_not_pass_account_check(self):
        value = customer()
        value["status"] = "paused"
        with patch.object(live, "request_json", return_value=(value, "b" * 64)):
            code, text, _errors = self.cli(["bridge", "--environment", "production",
                "--customer-id", CUSTOMER, "--key-file", self.key, "--out", self.folder / "bridge.json"])
        result = json.loads(text)
        self.assertEqual((code, result["state"]), (2, "READ_VERIFIED_ACCOUNT_NOT_READY"))
        self.assertTrue(result["observation"]["account_read_verified"])

    def test_dns_tls_and_timeouts_report_distinct_redacted_errors(self):
        for failure, expected in ((socket.gaierror("private"), "CONNECTION_DNS_FAILED"),
                (ssl.SSLError("private"), "CONNECTION_TLS_FAILED"), (TimeoutError("private"), "CONNECTION_TIMEOUT")):
            with patch.object(live, "HTTPSConnection") as connection:
                connection.return_value.request.side_effect = failure
                self.rejected(expected, lambda: live.request_json("api.bridge.xyz", "GET",
                    "/v0/customers/" + CUSTOMER, api_key=KEY))
                connection.return_value.close.assert_called_once()

    def test_local_verified_tls_contract_never_creates_transfers(self):
        # This is a local transport test, not an external-provider acceptance result.
        fixture, original = ProviderFixture(), http.client.HTTPSConnection
        trusted = ssl.create_default_context(cafile=str(CERT))

        def connection(host, *, timeout, context):
            self.assertEqual(host, "api.bridge.xyz")
            self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)
            self.assertTrue(context.check_hostname)
            return original("127.0.0.1", fixture.port, timeout=timeout, context=trusted)

        with fixture.serve(), patch.object(live, "HTTPSConnection", connection):
            result = live.bridge_read("production", CUSTOMER, self.key)
            self.assertEqual(result["response_sha256"], hashlib.sha256(canonical(customer()).encode()).hexdigest())
            self.assertEqual(fixture.requests[0]["method"], "GET")
            self.assertEqual(fixture.requests[0]["headers"]["Api-Key"], KEY)
            self.assertIsNone(fixture.requests[0]["body"])
            self.assertEqual(fixture.effects, {})

    def test_redirect_status_encoding_length_and_json_fail_closed(self):
        fixture, original = ProviderFixture(), http.client.HTTPSConnection
        trusted = ssl.create_default_context(cafile=str(CERT))

        def connection(_host, *, timeout, context):
            return original("127.0.0.1", fixture.port, timeout=timeout, context=trusted)

        with fixture.serve(), patch.object(live, "HTTPSConnection", connection):
            cases = [("status", 302, "CONNECTION_HTTP_302"),
                     ("status", 401, "CONNECTION_HTTP_401"),
                     ("status", 429, "CONNECTION_HTTP_429"),
                     ("encoding", "gzip", "CONNECTION_ENCODING_REJECTED"),
                     ("content_type", "text/html", "CONNECTION_ENCODING_REJECTED"),
                     ("declared_length", str(live.MAX_RESPONSE + 1), "CONNECTION_RESPONSE_TOO_LARGE"),
                     ("body_override", b'{"id":1,"id":2}', "CONNECTION_JSON_REJECTED"),
                     ("body_override", b"null", "CONNECTION_JSON_REJECTED")]
            for name, value, expected in cases:
                with self.subTest(field=name, value=value):
                    old = getattr(fixture, name)
                    setattr(fixture, name, value)
                    try:
                        self.rejected(expected, lambda: live.bridge_read("production", CUSTOMER, self.key))
                    finally:
                        setattr(fixture, name, old)
            self.assertEqual(fixture.effects, {})
            self.assertEqual(len(fixture.requests), len(cases))
