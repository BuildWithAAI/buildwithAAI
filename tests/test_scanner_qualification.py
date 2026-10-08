"""SYNTHETIC protocol responses; no live providers or Telegram messages."""
import io
import json
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch
from src.aai_scanner.__main__ import main
from src.aai_scanner.config import Config
from src.aai_scanner.qualification import qualify_providers
from src.aai_scanner.transport import MAINNET_GENESIS, ProviderError
from tests.scanner_fixtures import ACCOUNT, MINT, mint_response


def response(url, payload, **kwargs):
    method = payload["method"]
    if method == "getGenesisHash":
        result = MAINNET_GENESIS
    elif method == "getAccountInfo":
        result = mint_response()["result"]
    elif method == "getTokenLargestAccounts":
        result = {"context": {"slot": 100}, "value": [{"address": ACCOUNT, "amount": "1", "decimals": 6}]}
    elif method == "getSignaturesForAddress":
        result = [{"signature": "1" * 64, "slot": 100, "err": None, "blockTime": None, "confirmationStatus": "finalized"}]
    elif method == "getBalance":
        result = {"context": {"slot": 100}, "value": 0}
    else:
        raise AssertionError("Unexpected method")
    return {"jsonrpc": "2.0", "id": 1, "result": result}, "SYNTHETIC_RAW_HASH"


class ProviderQualificationTests(unittest.TestCase):
    def test_all_required_methods_are_validated_once_with_finalized_commitment(self):
        with patch("src.aai_scanner.transport.fetch_json", side_effect=response) as api:
            result = qualify_providers(Config(), MINT, ACCOUNT)
        self.assertEqual(result["status"], "PASSED")
        methods = [call.args[1]["method"] for call in api.call_args_list]
        self.assertEqual(methods, ["getGenesisHash", "getAccountInfo", "getSignaturesForAddress", "getBalance", "getTokenLargestAccounts"])
        for call in api.call_args_list[1:]:
            self.assertEqual(call.args[1]["params"][1]["commitment"], "finalized")
        self.assertEqual(result["providers"][0]["checks"]["getBalance"]["summary"]["balance_sol"], "0.000000000")

    def test_wrong_network_blocks_every_capability_read(self):
        with patch("src.aai_scanner.transport.fetch_json", return_value=({"jsonrpc": "2.0", "id": 1, "result": "wrong"}, "SYNTHETIC")) as api:
            result = qualify_providers(Config())
        self.assertEqual(api.call_count, 1)
        self.assertEqual(result["status"], "FAILED")
        self.assertEqual(result["providers"][0]["checks"]["getAccountInfo"]["status"], "UNVERIFIED")

    def test_each_provider_qualifies_independently_and_missing_holders_are_not_hidden(self):
        config = replace(Config(), rpc_url="https://first.test/private-key?token=secret", rpc_fallback_urls=("https://second.test/other-key",))
        def mixed(url, payload, **kwargs):
            if "first.test" in url and payload["method"] == "getTokenLargestAccounts":
                raise ProviderError("HTTP failure", code="HTTP_ERROR", http_status=403)
            return response(url, payload, **kwargs)
        with patch("src.aai_scanner.transport.fetch_json", side_effect=mixed):
            result = qualify_providers(config, MINT)
        self.assertEqual([p["status"] for p in result["providers"]], ["FAILED", "PASSED"])
        self.assertTrue(result["at_least_one_provider_qualified"])
        self.assertFalse(result["all_configured_providers_qualified"])
        encoded = json.dumps(result)
        self.assertNotIn("secret", encoded)
        self.assertNotIn("private-key", encoded)
        self.assertIn("second.test", encoded)
        self.assertEqual(result["providers"][0]["checks"]["getTokenLargestAccounts"]["source"]["error"]["http_status"], 403)
        with patch("src.aai_scanner.transport.fetch_json", side_effect=mixed):
            strict = qualify_providers(config, MINT, require_all=True)
        self.assertEqual(strict["status"], "FAILED")
        self.assertEqual(strict["required_policy"], "ALL_CONFIGURED_PROVIDERS")

    def test_cooldown_does_not_trigger_immediate_additional_requests(self):
        def limited(url, payload, **kwargs):
            if payload["method"] == "getAccountInfo":
                raise ProviderError("Rate limit", code="HTTP_ERROR", http_status=429, retry_after=60)
            return response(url, payload, **kwargs)
        with patch("src.aai_scanner.transport.fetch_json", side_effect=limited) as api:
            result = qualify_providers(Config())
        self.assertEqual(api.call_count, 2)
        self.assertEqual(result["status"], "FAILED")
        self.assertEqual(result["providers"][0]["checks"]["getBalance"]["source"]["error"]["code"], "COOLDOWN")

    def test_invalid_holder_units_or_balance_never_qualify(self):
        for bad_method in ("getTokenLargestAccounts", "getBalance"):
            def malformed(url, payload, **kwargs):
                data, digest = response(url, payload, **kwargs)
                if payload["method"] == bad_method:
                    if bad_method == "getBalance":
                        data["result"]["value"] = True
                    else:
                        data["result"]["value"][0]["decimals"] = 5
                return data, digest
            with patch("src.aai_scanner.transport.fetch_json", side_effect=malformed):
                self.assertEqual(qualify_providers(Config(), MINT)["status"], "FAILED")

    def test_invalid_address_is_rejected_before_any_request(self):
        with patch("src.aai_scanner.transport.fetch_json") as api, self.assertRaises(ValueError):
            qualify_providers(Config(), "bad")
        api.assert_not_called()

    def test_cli_writes_nested_evidence_and_never_opens_database(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "new" / "proof.json"
            database = Path(folder) / "must-not-create.sqlite3"
            with patch.dict("os.environ", {"AAI_DATABASE": str(database)}), patch("sys.argv", ["scanner", "provider-check", "--mint", MINT, "--output", str(output)]), patch("sys.stdout", new_callable=io.StringIO), patch("src.aai_scanner.transport.fetch_json", side_effect=response):
                self.assertEqual(main(), 0)
            self.assertEqual(json.loads(output.read_text())["status"], "PASSED")
            self.assertFalse(database.exists())

    def test_cli_returns_nonzero_when_no_configured_provider_qualifies(self):
        with patch("sys.argv", ["scanner", "provider-check"]), patch("sys.stdout", new_callable=io.StringIO), patch("src.aai_scanner.transport.fetch_json", side_effect=ProviderError("SYNTHETIC failure")):
            self.assertEqual(main(), 1)
