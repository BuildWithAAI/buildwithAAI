"""Offline checks for provenance, allowlisted reads, tape features, and paper fusion."""
from __future__ import annotations

import base64
import json
import struct
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from src.multi_brain_research.brain_input import features, paper_long_support
from src.multi_brain_research.brain_votes import vote
from src.multi_brain_research.control_brains import frozen_prior
from src.multi_brain_research.curve_read import read_curve as read_curve_file
from src.multi_brain_research.giant_brain import fuse, paper_backtest, source_status
from src.multi_brain_research.hold_check import live_read
from src.multi_brain_research.host_capture import capture_mint
from src.multi_brain_research.inventory_gate import CURVE, TOKEN
from src.multi_brain_research.live_curve import CurveReadError, read_curve
from src.multi_brain_research.paper_log import append
from src.multi_brain_research.pump_trade import PROGRAM_DATA, TRADE_DISCRIMINATOR
from src.multi_brain_research.receipt_bridge import to_module_output
from src.multi_brain_research.rpc_allow import ALLOWED
from src.multi_brain_research.tape_brain import read
from src.solana_research.coin_evidence import ENDPOINTS, b58decode
from src.solana_research.rpc import PUBLIC_ENDPOINTS, rpc_call


def _observation(**overrides):
    row = {
        "mint": TOKEN,
        "pool": CURVE,
        "price_quote_per_base": 1.2,
        "previous_price": 1.0,
        "buy_quote_atoms": 4,
        "sell_quote_atoms": 1,
        "liquidity_quote": 120,
        "previous_liquidity_quote": 100,
        "classification": "OBSERVED",
        "decision_time_ms": 1_700_000_000_000,
    }
    row.update(overrides)
    return row


def _trade_log(mint: str, *, virtual_sol=2_000_000, virtual_token=1_000_000, fee_bps=100) -> str:
    body = bytearray(161)
    body[0:32] = b58decode(mint)
    body[48] = 1
    struct.pack_into("<4Q", body, 89, virtual_sol, virtual_token, 20, 10)
    struct.pack_into("<Q", body, 153, fee_bps)
    raw = TRADE_DISCRIMINATOR + bytes(body)
    return PROGRAM_DATA + base64.b64encode(raw).decode()


class ProvenanceTests(unittest.TestCase):
    def test_missing_and_placeholder_pins_are_rejected(self):
        receipt = frozen_prior((-0.2, 0.0, 0.0, 0.1))
        self.assertNotEqual(receipt["graph_sha256"], "a" * 64)
        output = to_module_output(receipt, "b" * 64, 1_100)
        self.assertEqual(output.graph_sha256, receipt["graph_sha256"])
        for field, value in (
            ("graph_sha256", None),
            ("model_sha256", "a" * 64),
            ("task_sha256", "0" * 64),
            ("graph_sha256", "A" * 64),
            ("model_sha256", "ab"),
        ):
            broken = dict(receipt)
            broken[field] = value
            with self.subTest(field=field, value=value):
                with self.assertRaisesRegex(ValueError, "INVALID_PROVENANCE"):
                    to_module_output(broken, "b" * 64, 1_100)


class SignalTests(unittest.TestCase):
    def test_account_price_does_not_invent_a_return_and_direction_changes_the_score(self):
        account = features({"price_quote_per_base": 0.00002796, "classification": "ACCOUNT_DECODE_NOT_A_TRADE"})
        self.assertIsNone(account["features"]["signed_return"])
        self.assertIsNone(paper_long_support(account)["prediction_ppm"])
        up = paper_long_support(features(_observation()))
        down = paper_long_support(features(_observation(
            price_quote_per_base=0.8, buy_quote_atoms=1, sell_quote_atoms=5,
            liquidity_quote=70,
        )))
        self.assertGreater(up["prediction_ppm"], down["prediction_ppm"])
        self.assertNotEqual(up["prediction_ppm"], 650_000)
        ballots_up = vote((0.4, 0.5, 0.2, 0.8))["ballots"][0]["prediction_ppm"]
        ballots_down = vote((-0.2, -0.2, -0.2, 0.15))["ballots"][0]["prediction_ppm"]
        self.assertGreater(ballots_up, ballots_down)

    def test_tape_without_history_abstains_and_a_priced_tape_does_not_use_a_fixed_score(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            empty = root / "missing.jsonl"
            self.assertEqual(read(empty)["reason"], "NO_TAPE")
            bare = root / "bare.jsonl"
            bare.write_text(json.dumps({"slot": 1}) + "\n")
            self.assertIsNone(read(bare)["prediction_ppm"])
            priced = root / "priced.jsonl"
            priced.write_text(json.dumps(_observation(slot=9)) + "\n")
            body = read(priced)
            self.assertEqual(body["slot"], 9)
            self.assertNotEqual(body["prediction_ppm"], 650_000)
            self.assertGreater(body["prediction_ppm"], 500_000)


class AllowlistTests(unittest.TestCase):
    def test_public_endpoint_sets_match(self):
        self.assertEqual(set(ENDPOINTS), set(ALLOWED))
        self.assertEqual(PUBLIC_ENDPOINTS, ALLOWED)

    def test_curve_and_hold_readers_refuse_before_opening_a_socket(self):
        with patch("src.multi_brain_research.public_rpc.build_opener") as opener:
            with self.assertRaises(CurveReadError):
                read_curve("https://evil.example")
            with self.assertRaises(ValueError):
                read_curve_file("https://evil.example", Path("/tmp/aai-curve-refused.json"))
            with self.assertRaises(ValueError):
                live_read("holder", "https://evil.example", 30)
            with self.assertRaises(ValueError):
                capture_mint("https://evil.example", TOKEN, CURVE, Path("/tmp/aai-capture-refused.jsonl"))
            opener.assert_not_called()
        with patch("src.solana_research.rpc.build_opener") as opener:
            with self.assertRaises(ValueError):
                rpc_call("https://evil.example", "getBlock", [1])
            opener.assert_not_called()


class CaptureTests(unittest.TestCase):
    def test_a_pump_trade_log_is_kept_and_a_log_without_the_event_is_omitted(self):
        line = _trade_log(TOKEN)
        seen = {"calls": 0}

        def transport(method, params):
            seen["calls"] += 1
            if method == "getSignaturesForAddress":
                return {"result": [{"signature": "sig-trade"}, {"signature": "sig-empty"}, "not-a-row"]}
            if method == "getTransaction" and params[0] == "sig-trade":
                return {"result": {
                    "slot": 42,
                    "transaction": {"message": {"accountKeys": [CURVE, TOKEN]}},
                    "meta": {"err": None, "logMessages": [line]},
                }}
            if method == "getTransaction":
                return {"result": {
                    "slot": 43,
                    "transaction": {"message": {"accountKeys": [CURVE]}},
                    "meta": {"err": None, "logMessages": ["Program log: no trade"]},
                }}
            raise AssertionError(method)

        with tempfile.TemporaryDirectory() as folder:
            out = Path(folder) / "mint.jsonl"
            result = capture_mint(
                "https://api.mainnet-beta.solana.com", TOKEN, CURVE, out, transport=transport,
            )
            self.assertEqual(result["kept"], 1)
            self.assertEqual(result["omitted"], 2)
            self.assertEqual(result["action"], "NO_EXECUTION")
            row = json.loads(out.read_text().splitlines()[0])
            self.assertEqual(row["observed_price"], 2)
            self.assertEqual(row["fee_bps"], 100)
            self.assertEqual(row["mint"], TOKEN)
            self.assertEqual(seen["calls"], 3)


class GiantBrainTests(unittest.TestCase):
    def test_fusion_explains_votes_and_does_not_execute(self):
        up = fuse(_observation(), now_ms=1_700_000_000_000)
        down = fuse(_observation(
            price_quote_per_base=0.8, buy_quote_atoms=1, sell_quote_atoms=5, liquidity_quote=70,
        ), now_ms=1_700_000_000_000)
        self.assertFalse(up["execution_allowed"])
        self.assertEqual(up["mode"], "PAPER")
        self.assertFalse(up["live_orders"])
        self.assertEqual(up["primary"], "flyvis")
        self.assertNotIn("tape", up["brains"])
        self.assertEqual(up["inputs"]["role"], "MARKET_INPUT_NOT_A_VOTE")
        self.assertEqual(up["inputs"]["tape_role"], "TEST_FIXTURE")
        self.assertNotEqual(up["inputs"]["features"]["signed_return"], down["inputs"]["features"]["signed_return"])
        self.assertEqual(up["coordinator"]["research_signal"], "ABSTAIN")
        self.assertEqual(up["coordinator"]["action"], "NO_EXECUTION")
        self.assertIn("READOUT", up["brains"]["flyvis"]["reason"])
        self.assertTrue(up["brains"]["flyvis"]["primary"])
        self.assertFalse(up["brains"]["flyvis"]["executed"])
        self.assertFalse(up["brains"]["flyvis"].get("network_forward_pass", False))
        self.assertFalse(up["brains"]["crow"]["biological_model"])
        self.assertEqual(up["brains"]["crow"]["detail"], "CROW_MEMORY_EMPTY")
        fly_ppm = up["brains"]["flyvis"].get("paper_long_support_ppm")
        for pin in (
            up["provenance"]["crow_graph_sha256"],
            up["provenance"]["fly_graph_sha256"],
            up["provenance"]["coordinator_record_sha256"],
        ):
            self.assertNotEqual(pin, "a" * 64)
            self.assertEqual(len(pin), 64)
        modules = {row["module_id"]: row["vote"] for row in up["coordinator"]["modules"]}
        if type(fly_ppm) is int:
            self.assertIn(modules["flyvis_market_v1"], {"BUY_SUPPORT", "NO_BUY_SUPPORT"})
            self.assertEqual(up["fused_score_ppm"], fly_ppm)
        else:
            self.assertEqual(modules["flyvis_market_v1"], "UNAVAILABLE")
            self.assertIsNone(up["fused_score_ppm"])
        self.assertNotIn("tape_heuristic_v1", modules)
        self.assertEqual(modules["crow_memory_v1"], "ABSTAIN")
        if "hemibrain" in up["council"]:
            self.assertTrue(up["brains"]["hemibrain"]["council_member"])
            self.assertNotIn("hemibrain", up["shadow"])
        else:
            self.assertFalse(up["shadow"]["hemibrain"]["in_vote"])

    def test_hemibrain_is_shadow_until_admission_passes(self):
        refused = {"ready": False, "reasons": ["GRAPH_FILE_ABSENT"], "role": "SHADOW", "action": "NO_EXECUTION", "execution_allowed": False}
        with patch("src.multi_brain_research.first_brain.admission", return_value=refused):
            signal = fuse(_observation(), now_ms=1_700_000_000_000)
        self.assertNotIn("hemibrain", signal["council"])
        self.assertFalse(signal["shadow"]["hemibrain"]["in_vote"])
        self.assertFalse(signal["shadow"]["hemibrain"]["council_member"])
        modules = {row["module_id"] for row in signal["coordinator"]["modules"]}
        self.assertNotIn("fly_hemibrain_adverse_v1", modules)
        self.assertIn("flyvis", signal["council"])
        self.assertIn("crow", signal["council"])

    def test_paper_backtest_records_a_hypothetical_and_crow_can_recall_it(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            log = root / "paper.jsonl"
            memory = root / "crow.jsonl"
            first = _observation()
            second = _observation(price_quote_per_base=1.5, decision_time_ms=1_700_000_300_000)
            result = paper_backtest([first, second], log, memory)
            self.assertEqual(result["rows"], 2)
            self.assertFalse(result["execution_allowed"])
            self.assertIsNotNone(result["paper_pnl_per_unit_sum"])
            lines = [json.loads(line) for line in log.read_text().splitlines()]
            self.assertIn(lines[0]["hypothetical"]["position"], {"PAPER_LONG", "PAPER_FLAT"})
            self.assertEqual(lines[0]["hypothetical"]["fill"], "HYPOTHETICAL_NOT_A_VENUE_FILL")
            self.assertTrue(all(line["mode"] == "PAPER" and line["live_orders"] is False for line in lines))
            recalled = fuse(first, now_ms=1_700_000_600_000, memory_path=memory)
            self.assertEqual(recalled["brains"]["crow"]["detail"], "CROW_RECALL")
            self.assertGreater(recalled["brains"]["crow"]["paper_long_support_ppm"], 500_000)
            with self.assertRaises(ValueError):
                append(log, {"action": "NO_EXECUTION", "private_key": "never"})

    def test_unlisted_rpc_env_is_refused_and_a_missing_key_does_not_invent_a_source(self):
        with patch.dict("os.environ", {"GIANT_BRAIN_RPC_URL": "https://evil.example", "HELIUS_API_KEY": ""}, clear=False):
            status = source_status()
        self.assertEqual(status["solana_rpc"]["state"], "REFUSED_NOT_ALLOWLISTED")
        self.assertEqual(status["helius"]["used"], False)
        self.assertEqual(status["execution"], "PAPER_ONLY")
        self.assertFalse(status["flyvis"]["executed"])


if __name__ == "__main__":
    unittest.main()
