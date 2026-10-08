import io
import json
import unittest
from decimal import Decimal
from unittest.mock import patch
from src.aai_scanner.evidence import measurement, number, units
from src.aai_scanner.market import MarketClient, summarize_market, WRAPPED_SOL
from src.aai_scanner.mint import SPL_TOKEN, TOKEN_2022, parse_mint
from src.aai_scanner.transport import MAINNET_GENESIS, NoRedirect, ProviderError, RpcClient, fetch_json
from tests.scanner_fixtures import ACCOUNT, MINT, FakeMarket, mint_data, mint_response


class MintValidationTests(unittest.TestCase):
    def inspect(self, data, owner=SPL_TOKEN):
        return parse_mint(MINT, mint_response(data, owner), "https://rpc.test/?key=not-a-real-key")

    def test_legacy_token_account_cannot_be_misidentified_as_mint(self):
        self.assertEqual(self.inspect(mint_data() + bytes(83))["status"], "UNVERIFIED")

    def test_uninitialized_mint_remains_unverified(self):
        self.assertEqual(self.inspect(mint_data(initialized=0))["status"], "UNVERIFIED")

    def test_invalid_initialized_byte_is_rejected(self):
        self.assertEqual(self.inspect(mint_data(initialized=2))["status"], "UNVERIFIED")

    def test_invalid_authority_discriminant_is_rejected(self):
        data = mint_data()
        data[:4] = (2).to_bytes(4, "little")
        with self.assertRaises(ProviderError):
            self.inspect(data)

    def test_bare_token_2022_mint_is_supported(self):
        result = self.inspect(mint_data(), TOKEN_2022)
        self.assertEqual(result["token_program"], "Token-2022")
        self.assertEqual(result["supply"], "1000000.000000")

    def test_extended_token_2022_mint_preserves_unknown_semantics(self):
        data = mint_data() + bytes(83) + bytes([1]) + (3).to_bytes(2, "little") + (32).to_bytes(2, "little") + bytes(32)
        result = self.inspect(data, TOKEN_2022)
        self.assertEqual(result["extension_type_ids"], [3])
        self.assertIn("TOKEN_2022_EXTENSION_SEMANTICS_NOT_DECODED", result["quality_flags"])

    def test_token_2022_holding_account_is_not_a_mint(self):
        data = mint_data() + bytes(83) + bytes([2])
        self.assertEqual(self.inspect(data, TOKEN_2022)["status"], "UNVERIFIED")

    def test_truncated_extension_fails_closed(self):
        data = mint_data() + bytes(83) + bytes([1, 3, 0, 32, 0, 1])
        with self.assertRaises(ProviderError):
            self.inspect(data, TOKEN_2022)

    def test_malformed_base64_is_not_available(self):
        response = mint_response()
        response["result"]["value"]["data"] = ["invalid!", "base64"]
        with self.assertRaises(ProviderError):
            parse_mint(MINT, response, "https://rpc.test")

    def test_missing_slot_fails_validation(self):
        response = mint_response()
        response["result"]["context"] = {}
        with self.assertRaises(ProviderError):
            parse_mint(MINT, response, "https://rpc.test")

    def test_supply_with_255_decimals_is_exact(self):
        raw = 2**64 - 1
        self.assertEqual(Decimal(units(raw, 255)), Decimal(raw).scaleb(-255))
        self.assertTrue(units(raw, 255).endswith(str(raw)))

    def test_source_never_publishes_provider_query_credentials(self):
        result = self.inspect(mint_data())
        self.assertNotIn("key", json.dumps(result))
        self.assertEqual(result["source"], "rpc.test")


class TransportTests(unittest.TestCase):
    def client_payload(self, payload):
        return patch("src.aai_scanner.transport.fetch_json", return_value=(payload, "test-digest"))

    def test_transaction_method_is_blocked_before_network(self):
        with patch("src.aai_scanner.transport.fetch_json") as network:
            with self.assertRaises(ValueError):
                RpcClient("https://rpc.test").call("sendTransaction", [])
            network.assert_not_called()

    def test_wrong_network_blocks_mainnet_valuation(self):
        with self.client_payload({"jsonrpc": "2.0", "id": 1, "result": "DEVNET"}):
            with self.assertRaises(ProviderError):
                RpcClient("https://rpc.test").call("getBalance", [ACCOUNT])

    def test_successful_rpc_preserves_slot_hash_and_commitment(self):
        replies = [({"jsonrpc": "2.0", "id": 1, "result": MAINNET_GENESIS}, "genesis-hash"),
                   ({"jsonrpc": "2.0", "id": 1, "result": {"context": {"slot": 123}, "value": 0}}, "balance-hash")]
        with patch("src.aai_scanner.transport.fetch_json", side_effect=replies):
            result = RpcClient("https://rpc.test").call("getBalance", [ACCOUNT])
        self.assertEqual(result["_evidence"]["slot"], 123)
        self.assertEqual(result["_evidence"]["raw_sha256"], "balance-hash")
        self.assertEqual(result["_evidence"]["commitment"], "finalized")

    def test_rpc_wrong_response_id_is_rejected(self):
        with self.client_payload({"jsonrpc": "2.0", "id": 2, "result": MAINNET_GENESIS}):
            with self.assertRaises(ProviderError):
                RpcClient("https://rpc.test").ensure_mainnet()

    def test_rpc_error_cannot_become_missing_account(self):
        with self.client_payload({"jsonrpc": "2.0", "id": 1, "error": {"message": "not a real credential"}}):
            with self.assertRaises(ProviderError):
                RpcClient("https://rpc.test").ensure_mainnet()

    def test_plain_http_and_url_user_credentials_are_rejected(self):
        for endpoint in ("http://rpc.test", "https://user:password@rpc.test", "https://rpc.test:1234"):
            with self.subTest(endpoint=endpoint), self.assertRaises(ValueError):
                RpcClient(endpoint)

    def test_redirects_are_not_followed(self):
        self.assertIsNone(NoRedirect().redirect_request(None, None, 302, "", {}, "http://127.0.0.1"))

    def test_response_size_limit_is_enforced(self):
        with patch("urllib.request.build_opener") as opener:
            opener.return_value.open.return_value = io.BytesIO(b"123456")
            with self.assertRaises(ProviderError):
                fetch_json("https://rpc.test", limit=4)

    def test_invalid_json_and_nonfinite_numbers_are_rejected(self):
        for raw in (b"not-json", b'{"value":NaN}'):
            with self.subTest(raw=raw), patch("urllib.request.build_opener") as opener:
                opener.return_value.open.return_value = io.BytesIO(raw)
                with self.assertRaises(ProviderError):
                    fetch_json("https://rpc.test")


class MarketTests(unittest.TestCase):
    def test_quote_side_and_wrong_chain_prices_are_never_reused(self):
        rows = [
            {"chainId": "solana", "pairAddress": ACCOUNT, "baseToken": {"address": WRAPPED_SOL}, "quoteToken": {"address": MINT}, "priceUsd": "999"},
            {"chainId": "ethereum", "pairAddress": ACCOUNT, "baseToken": {"address": MINT}, "priceUsd": "999"},
        ]
        with patch("src.aai_scanner.market.fetch_json", return_value=(rows, "digest")):
            pools, _ = MarketClient().pools(MINT)
        self.assertEqual(pools, [])

    def test_missing_market_cap_is_not_replaced_with_fdv(self):
        pools, source = FakeMarket().pools(MINT)
        sol, sol_source = FakeMarket().pools(WRAPPED_SOL)
        result = summarize_market(pools, source, sol, sol_source)
        self.assertIsNone(result["market_cap_usd"]["value"])
        self.assertEqual(result["market_cap_usd"]["status"], "UNAVAILABLE")
        self.assertEqual(result["fdv_usd"]["value"], "2000000")

    def test_usd_to_sol_price_uses_independent_reference_and_sources(self):
        pools, source = FakeMarket().pools(MINT)
        sol, sol_source = FakeMarket().pools(WRAPPED_SOL)
        result = summarize_market(pools, source, sol, sol_source)
        self.assertEqual(result["price_sol"]["value"], "0.02")
        self.assertEqual(result["price_sol"]["classification"], "DERIVED")
        self.assertEqual(len(result["price_sol"]["source"]), 2)

    def test_bad_provider_numbers_stay_missing(self):
        for value in ("Infinity", "NaN", -1, True, "1e99999"):
            self.assertIsNone(number(value))

    def test_missing_is_distinct_from_observed_zero(self):
        self.assertEqual(measurement(0, {})["status"], "AVAILABLE")
        self.assertEqual(measurement(None, {})["status"], "UNAVAILABLE")
