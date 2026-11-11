"""Holder concentration from recorded RPC payloads. No network."""
from __future__ import annotations

import io
import json
import unittest
import urllib.error
from email.message import Message
from unittest.mock import patch

from src.multi_brain_research.giant_brain import fuse
from src.multi_brain_research.holder_concentration import (
    BONDING_CURVE,
    POOL_VAULT,
    RULE_TOP10_SHARE_PPM,
    UNCLASSIFIED,
    interpret,
    live_read,
)
from src.multi_brain_research.inventory_gate import CURVE, TOKEN
from src.multi_brain_research.live_curve import PUMP
from src.multi_brain_research.public_rpc import post
from src.multi_brain_research.snapshot_feed import observation_from_pair
from src.multi_brain_research.thesis import validate_thesis, write_thesis

MINT = "5fgJwPNtsohc1FwjkjvmVWoXTbSzD8Z3zzbcuXdepump"
PAIR = "6eX7ud2Kgb9grPEbyyVouGvLVkD41yMn2n8erbhYTooq"
WALLET = TOKEN
CURVE_PDA = CURVE
VAULT_ACCOUNT = "4BCbx4hB1XPmC5mLHsFyHEghC5fb9Afu7THLGXiHpump"
HOLDER_ACCOUNT = "5ZndeMaC36YapnG4UpXsFg2DXDquHw6xEpBXGfmfpump"
CURVE_ACCOUNT = "FQE9h4fL65oDHMsR2MHcSe6d6DF4hFrFarsQQkVJpump"
SYSTEM = "11111111111111111111111111111111"
ENDPOINT = "https://api.mainnet-beta.solana.com"
WHEN = 1_700_000_000_000


def _supply(amount="1000", slot=10, decimals=6):
    return {"jsonrpc": "2.0", "result": {"context": {"slot": slot}, "value": {
        "amount": amount, "decimals": decimals, "uiAmount": None, "uiAmountString": "0",
    }}, "id": 1}


def _largest(rows, slot=10):
    return {"jsonrpc": "2.0", "result": {"context": {"slot": slot}, "value": [
        {"address": address, "amount": str(amount), "decimals": 6, "uiAmount": 0.1, "uiAmountString": "0.1"}
        for address, amount in rows
    ]}, "id": 1}


def _token(owner, amount, mint=MINT):
    return {
        "owner": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
        "data": {"parsed": {"type": "account", "info": {
            "mint": mint,
            "owner": owner,
            "tokenAmount": {"amount": str(amount), "decimals": 6, "uiAmount": None},
        }}, "program": "spl-token"},
    }


def _program(program):
    return {"owner": program, "data": ["", "base64"], "lamports": 1, "executable": False}


def _signal():
    return {
        "fused_score_ppm": 700_000,
        "confidence_ppm": 333_333,
        "mint": MINT,
        "brains": {"flyvis": {"paper_long_support_ppm": 700_000, "detail": "FLASH_KERNEL_READOUT", "council_member": True}},
        "provenance": {"observation_sha256": "ab" * 32},
        "action": "NO_EXECUTION",
        "execution_allowed": False,
    }


def _record(**overrides):
    row = {
        "source": "dexscreener_pairs",
        "token_address": MINT,
        "symbol": "DEMO",
        "pair_address": PAIR,
        "dex": "pumpswap",
        "price_usd": 1.0,
        "liquidity_usd": 50_000.0,
        "volume_h1": 10_000.0,
        "price_change_h1": 20.0,
        "buys_h1": 30,
        "sells_h1": 10,
        "pair_created_at_ms": 1_000,
        "fetched_at": "2026-11-04T05:25:01+00:00",
    }
    row.update(overrides)
    return row


class InterpretTests(unittest.TestCase):
    def _mixed(self, *, token_payload=True, owner_payload=True, largest_slot=10):
        rows = [
            (HOLDER_ACCOUNT, 200),
            (VAULT_ACCOUNT, 700),
            (CURVE_ACCOUNT, 100),
        ]
        tokens = [
            _token(WALLET, 200),
            _token(PAIR, 700),
            _token(CURVE_PDA, 100),
        ]
        owners = [_program(SYSTEM), _program("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"), _program(PUMP)]
        return interpret(
            MINT, ENDPOINT, _supply(), _largest(rows, slot=largest_slot),
            token_accounts_payload=None if not token_payload else {"result": {"context": {"slot": largest_slot}, "value": tokens}},
            owner_accounts_payload=None if not owner_payload else {"result": {"context": {"slot": largest_slot}, "value": owners}},
            pair_address=PAIR,
            fetched_at_ms=WHEN,
        )

    def test_pool_and_curve_are_labeled_and_excluded_from_the_share(self):
        body = self._mixed()
        self.assertEqual(body["status"], "AVAILABLE")
        self.assertEqual(body["endpoint"], ENDPOINT)
        self.assertEqual(body["supply_slot"], 10)
        self.assertEqual(body["largest_slot"], 10)
        self.assertTrue(body["slots_match"])
        self.assertEqual(body["top1_atoms"], 700)
        self.assertEqual(body["top1_share_ppm"], 700_000)
        self.assertEqual(body["top10_share_ppm"], 1_000_000)
        self.assertEqual(body["top1_ex_vault_share_ppm"], 200_000)
        self.assertEqual(body["top10_ex_vault_share_ppm"], 200_000)
        self.assertEqual(body["top10_ex_vault_atoms"], 200)
        self.assertTrue(body["exclusion_applied"])
        by_account = {row["token_account"]: row for row in body["accounts"]}
        self.assertEqual(by_account[VAULT_ACCOUNT]["classification"], POOL_VAULT)
        self.assertEqual(by_account[VAULT_ACCOUNT]["classification_reason"], "OWNER_EQUALS_OBSERVED_PAIR")
        self.assertEqual(by_account[CURVE_ACCOUNT]["classification"], BONDING_CURVE)
        self.assertEqual(by_account[CURVE_ACCOUNT]["classification_reason"], "OWNER_PROGRAM_IS_PUMP")
        self.assertEqual(by_account[HOLDER_ACCOUNT]["classification"], UNCLASSIFIED)
        self.assertEqual(by_account[HOLDER_ACCOUNT]["classification_reason"], "OWNER_PROGRAM_NOT_POOL_OR_CURVE")
        self.assertEqual(by_account[HOLDER_ACCOUNT]["owner_program"], SYSTEM)
        self.assertNotIn("uiAmount", json.dumps(body["top10_share_ppm"]))

    def test_unclassified_accounts_stay_in_the_top_10_when_the_program_was_not_read(self):
        body = self._mixed(owner_payload=False)
        by_account = {row["token_account"]: row for row in body["accounts"]}
        self.assertEqual(by_account[VAULT_ACCOUNT]["classification"], POOL_VAULT)
        self.assertEqual(by_account[CURVE_ACCOUNT]["classification"], UNCLASSIFIED)
        self.assertEqual(by_account[CURVE_ACCOUNT]["classification_reason"], "OWNER_PROGRAM_UNAVAILABLE")
        self.assertEqual(body["top10_ex_vault_atoms"], 300)
        self.assertEqual(body["classification_note"], "OWNER_PROGRAM_UNAVAILABLE")

    def test_a_missing_classification_keeps_the_raw_share_and_says_so(self):
        body = self._mixed(token_payload=False, owner_payload=False)
        self.assertFalse(body["exclusion_applied"])
        self.assertIsNone(body["top10_ex_vault_share_ppm"])
        self.assertEqual(body["top10_share_ppm"], 1_000_000)
        self.assertEqual(body["share_basis"], "TOP10_RAW_VAULTS_NOT_EXCLUDED")
        self.assertTrue(all(row["classification"] == UNCLASSIFIED for row in body["accounts"]))
        self.assertTrue(all(row["classification_reason"] == "CLASSIFICATION_UNAVAILABLE" for row in body["accounts"]))

    def test_slot_mismatch_is_recorded_and_the_shares_stay_the_observed_ones(self):
        body = self._mixed(largest_slot=11)
        self.assertFalse(body["slots_match"])
        self.assertEqual(body["supply_slot"], 10)
        self.assertEqual(body["largest_slot"], 11)
        self.assertEqual(body["top1_ex_vault_share_ppm"], 200_000)

    def test_inconsistent_supply_and_zero_supply_do_not_invent_a_share(self):
        over = interpret(MINT, ENDPOINT, _supply("1000"), _largest([(HOLDER_ACCOUNT, 1001)]), fetched_at_ms=WHEN)
        self.assertEqual(over["status"], "UNAVAILABLE")
        self.assertEqual(over["reason"], "INCONSISTENT_SUPPLY")
        self.assertIsNone(over["top10_share_ppm"])
        self.assertIsNone(over["supply_atoms"])
        zero = interpret(MINT, ENDPOINT, _supply("0"), _largest([]), fetched_at_ms=WHEN)
        self.assertEqual(zero["reason"], "ZERO_SUPPLY")
        self.assertIsNone(zero["top1_share_ppm"])

    def test_a_rate_limit_on_largest_accounts_keeps_the_supply_slot_and_no_share(self):
        body = interpret(
            MINT, ENDPOINT, _supply(slot=77),
            {"jsonrpc": "2.0", "error": {"code": 429, "message": "Too many requests for a specific RPC call"}, "id": 1},
            fetched_at_ms=WHEN,
        )
        self.assertEqual(body["reason"], "RATE_LIMITED")
        self.assertEqual(body["failed_method"], "getTokenLargestAccounts")
        self.assertEqual(body["supply_slot"], 77)
        self.assertEqual(body["rpc_error_code"], 429)
        self.assertIsNone(body["supply_atoms"])
        self.assertIsNone(body["top10_share_ppm"])

    def test_a_json_rate_limit_records_the_code_and_no_share(self):
        body = interpret(
            MINT, ENDPOINT,
            {"jsonrpc": "2.0", "error": {"code": 429, "message": "Too many requests for a specific RPC call"}, "id": 1},
            _largest([]),
            fetched_at_ms=WHEN,
        )
        self.assertEqual(body["status"], "UNAVAILABLE")
        self.assertEqual(body["reason"], "RATE_LIMITED")
        self.assertEqual(body["rpc_error_code"], 429)
        self.assertEqual(body["failed_method"], "getTokenSupply")
        self.assertIsNone(body["top10_share_ppm"])
        self.assertEqual(body["accounts"], [])

    def test_rpc_error_and_decimal_mismatch_leave_the_share_empty(self):
        error = interpret(
            MINT, ENDPOINT,
            {"jsonrpc": "2.0", "error": {"code": -32602, "message": "Invalid param: not a Token mint"}, "id": 1},
            _largest([]),
            fetched_at_ms=WHEN,
        )
        self.assertEqual(error["reason"], "RPC_ERROR")
        self.assertEqual(error["rpc_error_code"], -32602)
        self.assertIsNone(error["top10_share_ppm"])
        mismatch = interpret(
            MINT, ENDPOINT, _supply(decimals=6),
            {"result": {"context": {"slot": 10}, "value": [
                {"address": HOLDER_ACCOUNT, "amount": "10", "decimals": 9},
            ]}},
            fetched_at_ms=WHEN,
        )
        self.assertEqual(mismatch["reason"], "INCONSISTENT_DECIMALS")
        self.assertIsNone(mismatch["top1_share_ppm"])

    def test_an_unlisted_endpoint_is_refused_before_a_payload_is_trusted(self):
        body = interpret(MINT, "https://evil.example", _supply(), _largest([(HOLDER_ACCOUNT, 10)]), fetched_at_ms=WHEN)
        self.assertEqual(body["reason"], "REFUSED")
        self.assertIsNone(body["endpoint"])
        self.assertIsNone(body["top10_share_ppm"])


class LiveReadTests(unittest.TestCase):
    def test_rate_limit_on_the_largest_accounts_call_stores_no_share(self):
        headers = Message()
        headers["Retry-After"] = "10"
        body = b' {"jsonrpc":"2.0","error":{"code": 429,"message":"Too many requests for a specific RPC call"}, "id": 1 } '
        calls = []

        def transport(method, params):
            calls.append(method)
            if method == "getTokenLargestAccounts":
                raise urllib.error.HTTPError(ENDPOINT, 429, "Too Many Requests", headers, io.BytesIO(body))
            if method == "getTokenSupply":
                return _supply()
            raise AssertionError(method)

        result = live_read(MINT, ENDPOINT, pair_address=PAIR, transport=transport, fetched_at_ms=WHEN)
        self.assertEqual(calls, ["getTokenSupply", "getTokenLargestAccounts"])
        self.assertEqual(result["status"], "UNAVAILABLE")
        self.assertEqual(result["reason"], "RATE_LIMITED")
        self.assertEqual(result["http_status"], 429)
        self.assertEqual(result["retry_after_seconds"], 10)
        self.assertEqual(result["rpc_error_code"], 429)
        self.assertEqual(result["failed_method"], "getTokenLargestAccounts")
        self.assertEqual(result["supply_slot"], 10)
        self.assertIsNone(result["top1_share_ppm"])
        self.assertIsNone(result["top10_share_ppm"])
        self.assertIsNone(result["supply_atoms"])
        self.assertEqual(result["accounts"], [])

    def test_a_refused_host_does_not_call_the_transport(self):
        def transport(method, params):
            raise AssertionError(method)

        result = live_read(MINT, "https://evil.example", transport=transport, fetched_at_ms=WHEN)
        self.assertEqual(result["reason"], "REFUSED")
        self.assertIsNone(result["top10_share_ppm"])

    def test_holder_methods_use_the_shared_client_and_other_methods_stay_refused(self):
        with patch("src.multi_brain_research.public_rpc.build_opener") as opener:
            with self.assertRaises(ValueError):
                post(ENDPOINT, "getProgramAccounts", [MINT])
            opener.assert_not_called()

        class Response:
            def read(self, _limit):
                return b'{"jsonrpc":"2.0","result":{"context":{"slot":3},"value":{"amount":"5","decimals":6}},"id":1}'

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

        with patch("src.multi_brain_research.public_rpc.build_opener") as opener:
            opener.return_value.open.return_value = Response()
            payload = post(ENDPOINT, "getTokenSupply", [MINT, {"commitment": "finalized"}])
        self.assertEqual(payload["result"]["value"]["amount"], "5")
        opener.return_value.open.assert_called_once()


class ThesisFlagTests(unittest.TestCase):
    def test_a_read_at_the_decision_becomes_clear_or_raised_with_the_rule(self):
        concentrated = interpret(
            MINT, ENDPOINT, _supply("1000"), _largest([(HOLDER_ACCOUNT, 600)]),
            token_accounts_payload={"result": {"value": [_token(WALLET, 600)]}},
            owner_accounts_payload={"result": {"value": [_program(SYSTEM)]}},
            pair_address=PAIR,
            fetched_at_ms=WHEN,
        )
        thesis = write_thesis(_signal(), _record(holder_concentration=concentrated), now_ms=WHEN)
        validate_thesis(thesis)
        flag = next(item for item in thesis["risk_flags"] if item["flag"] == "HOLDER_CONCENTRATION")
        self.assertEqual(flag["status"], "RAISED")
        self.assertEqual(flag["rule_top10_share_ppm"], RULE_TOP10_SHARE_PPM)
        self.assertEqual(flag["rule_top10_share_ppm"], 500_000)
        self.assertEqual(flag["observed"]["compared_share_ppm"], 600_000)
        self.assertEqual(flag["endpoint"], ENDPOINT)
        self.assertEqual(flag["supply_slot"], 10)
        self.assertEqual(flag["largest_slot"], 10)
        self.assertEqual(flag["fetched_at_ms"], WHEN)
        self.assertEqual(thesis["provenance"]["holder_supply_slot"], 10)
        self.assertTrue(any(point["evidence"].get("compared_share_ppm") == 600_000 for point in thesis["bear_case"]))
        dispersed = interpret(
            MINT, ENDPOINT, _supply("1000"), _largest([(HOLDER_ACCOUNT, 100)]),
            token_accounts_payload={"result": {"value": [_token(WALLET, 100)]}},
            owner_accounts_payload={"result": {"value": [_program(SYSTEM)]}},
            pair_address=PAIR,
            fetched_at_ms=WHEN,
        )
        clear = write_thesis(_signal(), _record(holder_concentration=dispersed), now_ms=WHEN)
        clear_flag = next(item for item in clear["risk_flags"] if item["flag"] == "HOLDER_CONCENTRATION")
        self.assertEqual(clear_flag["status"], "CLEAR")
        self.assertEqual(clear_flag["observed"]["top10_ex_vault_share_ppm"], 100_000)

    def test_a_missing_or_failed_read_stays_unavailable_without_a_share(self):
        missing = write_thesis(_signal(), _record(), now_ms=WHEN)
        flag = next(item for item in missing["risk_flags"] if item["flag"] == "HOLDER_CONCENTRATION")
        self.assertEqual(flag["status"], "UNAVAILABLE")
        self.assertEqual(flag["reason"], "NOT_IN_SNAPSHOT")
        self.assertIsNone(flag["observed"])
        self.assertNotIn("holder_endpoint", missing["provenance"])
        failed = live_read(MINT, ENDPOINT, transport=self._limited, fetched_at_ms=WHEN)
        thesis = write_thesis(_signal(), _record(holder_concentration=failed), now_ms=WHEN)
        failed_flag = next(item for item in thesis["risk_flags"] if item["flag"] == "HOLDER_CONCENTRATION")
        self.assertEqual(failed_flag["status"], "UNAVAILABLE")
        self.assertEqual(failed_flag["reason"], "RATE_LIMITED")
        self.assertIsNone(failed_flag["observed"])
        self.assertIsNone(thesis["observed"]["holder_concentration"])
        self.assertNotIn("compared_share_ppm", json.dumps(failed_flag))
        bare = write_thesis(_signal(), _record(holder_concentration=0.42), now_ms=WHEN)
        bare_flag = next(item for item in bare["risk_flags"] if item["flag"] == "HOLDER_CONCENTRATION")
        self.assertEqual(bare_flag["reason"], "NOT_A_READ")
        self.assertIsNone(bare["observed"]["holder_concentration"])

    def test_a_read_after_the_decision_is_not_copied_into_the_thesis(self):
        read = interpret(
            MINT, ENDPOINT, _supply(), _largest([(HOLDER_ACCOUNT, 900)]),
            token_accounts_payload={"result": {"value": [_token(WALLET, 900)]}},
            owner_accounts_payload={"result": {"value": [_program(SYSTEM)]}},
            fetched_at_ms=WHEN + 5_000,
        )
        thesis = write_thesis(_signal(), _record(holder_concentration=read), now_ms=WHEN)
        flag = next(item for item in thesis["risk_flags"] if item["flag"] == "HOLDER_CONCENTRATION")
        self.assertEqual(flag["status"], "UNAVAILABLE")
        self.assertEqual(flag["reason"], "AFTER_DECISION")
        self.assertIsNone(flag["observed"])
        self.assertNotIn("900000", json.dumps(flag))

    @staticmethod
    def _limited(method, params):
        headers = Message()
        headers["Retry-After"] = "10"
        raise urllib.error.HTTPError(
            ENDPOINT, 429, "Too Many Requests", headers,
            io.BytesIO(b'{"jsonrpc":"2.0","error":{"code":429,"message":"Too many requests"},"id":1}'),
        )


class CouncilInputTests(unittest.TestCase):
    def test_a_causal_read_is_an_input_and_does_not_change_the_vote(self):
        observation = {
            "mint": TOKEN,
            "pool": CURVE,
            "price_quote_per_base": 1.2,
            "previous_price": 1.0,
            "buy_quote_atoms": 4,
            "sell_quote_atoms": 1,
            "liquidity_quote": 120,
            "previous_liquidity_quote": 100,
            "classification": "OBSERVED",
        }
        plain = fuse(observation, now_ms=WHEN)
        read = interpret(
            MINT, ENDPOINT, _supply(), _largest([(HOLDER_ACCOUNT, 800)]),
            token_accounts_payload={"result": {"value": [_token(WALLET, 800)]}},
            owner_accounts_payload={"result": {"value": [_program(SYSTEM)]}},
            fetched_at_ms=WHEN,
        )
        early = dict(observation)
        early["holder_concentration"] = read
        late = dict(observation)
        late_read = dict(read)
        late_read["fetched_at_ms"] = WHEN + 1
        late["holder_concentration"] = late_read
        with_early = fuse(early, now_ms=WHEN)
        with_late = fuse(late, now_ms=WHEN)
        self.assertEqual(with_early["fused_score_ppm"], plain["fused_score_ppm"])
        self.assertEqual(with_late["fused_score_ppm"], plain["fused_score_ppm"])
        self.assertEqual(with_early["inputs"]["holder_concentration"]["role"], "INPUT_NOT_A_VOTE")
        self.assertEqual(with_early["inputs"]["holder_concentration"]["status"], "AVAILABLE")
        self.assertEqual(with_early["inputs"]["holder_concentration"]["top10_ex_vault_share_ppm"], 800_000)
        self.assertEqual(with_late["inputs"]["holder_concentration"]["status"], "NOT_CAUSAL")
        self.assertIsNone(with_late["inputs"]["holder_concentration"]["top10_share_ppm"])
        self.assertNotIn("holder", with_early["brains"])
        modules = {row["module_id"] for row in with_early["coordinator"]["modules"]}
        self.assertFalse(any("holder" in module for module in modules))
        copied = observation_from_pair({"source": "dexscreener_pairs", "price_usd": 1.0, "token_address": MINT, "holder_concentration": read})
        self.assertEqual(copied["holder_concentration"]["top10_share_ppm"], read["top10_share_ppm"])


if __name__ == "__main__":
    unittest.main()
