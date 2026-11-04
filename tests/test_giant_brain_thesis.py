"""Thesis schema, paper ledger, snapshot rows, and the disabled live gate."""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from src.multi_brain_research.execution import (
    ENV_CONFIG,
    ENV_FLAG,
    LIVE_VALUE,
    ExecutionError,
    LiveAdapter,
    enforce,
    live_opt_in,
    load_config,
)
from src.multi_brain_research.paper_trader import assumed_slippage_bps, mark, metrics, open_position
from src.multi_brain_research.snapshot_feed import (
    SnapshotError,
    canonical_pairs,
    fetch_json,
    fetch_pair_metrics,
    load_latest,
    load_snapshot,
    observation_from_pair,
    parse_time_ms,
)
from src.multi_brain_research.thesis import numbers_allowed, validate_thesis, write_files, write_thesis
from src.multi_brain_research.watch import replay


def _signal(score=700_000, tape=700_000, crow=650_000):
    return {
        "fused_score_ppm": score,
        "confidence_ppm": 333_333,
        "mint": "Mint111",
        "brains": {
            "tape": {"paper_long_support_ppm": tape, "detail": "TAPE_HEURISTIC", "role": "TEST_FIXTURE", "council_member": False},
            "crow": {"paper_long_support_ppm": crow, "detail": "CROW_RECALL", "council_member": True},
            "flyvis": {"paper_long_support_ppm": None, "reason": "MISSING_READOUT", "executed": False, "council_member": True, "primary": True},
            "hemibrain": {"paper_long_support_ppm": 900_000, "detail": "SHADOW", "shadow": True, "role": "SHADOW", "council_member": False},
        },
        "provenance": {"observation_sha256": "ab" * 32},
        "action": "NO_EXECUTION",
        "execution_allowed": False,
    }


def _record(**overrides):
    row = {
        "source": "dexscreener_pairs",
        "chain": "solana",
        "token_address": "Mint111",
        "symbol": "DEMO",
        "pair_address": "Pair111",
        "dex": "pump_fun",
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


def _config(**overrides):
    data = {
        "live_enabled": False,
        "kill_switch": False,
        "max_position_notional_usd": 25,
        "max_daily_loss_usd": 50,
        "max_open_positions": 2,
        "token_allowlist": ["Mint111"],
        "venue_allowlist": ["paper"],
    }
    data.update(overrides)
    return data


def _order(**overrides):
    row = {"mint": "Mint111", "venue": "paper", "side": "BUY", "notional_usd": 10}
    row.update(overrides)
    return row


class ThesisTests(unittest.TestCase):
    def test_schema_uses_only_observed_numbers_and_skips_a_low_score(self):
        self.assertIsNone(write_thesis(_signal(score=100_000), _record(), now_ms=90_000_000, threshold_ppm=600_000))
        thesis = write_thesis(_signal(), _record(), now_ms=90_000_000, threshold_ppm=600_000)
        validate_thesis(thesis)
        self.assertEqual(thesis["proposal"]["entry_price_usd"], 1.0)
        self.assertAlmostEqual(thesis["proposal"]["stop_price_usd"], 0.8)
        self.assertAlmostEqual(thesis["proposal"]["take_profit_price_usd"], 1.4)
        self.assertEqual(thesis["execution_allowed"], False)
        self.assertEqual(thesis["action"], "NO_EXECUTION")
        flags = {item["flag"]: item["status"] for item in thesis["risk_flags"]}
        self.assertEqual(flags["HOLDER_CONCENTRATION"], "UNAVAILABLE")
        self.assertEqual(flags["LIQUIDITY"], "CLEAR")
        self.assertTrue(any(point["evidence"].get("buys_h1") == 30 for point in thesis["bull_case"]))
        self.assertFalse(numbers_allowed("The price is 99999.", thesis))
        self.assertEqual(
            write_thesis(_signal(), _record(), now_ms=90_000_000, narrative="The price is 99999.")["narrative_source"],
            "NARRATIVE_REJECTED_UNSOURCED_NUMBER",
        )
        kept = write_thesis(_signal(), _record(), now_ms=90_000_000, narrative="DEMO price is 1.0 with change 20.0.")
        self.assertEqual(kept["narrative_source"], "MODEL_PHRASING_NUMBERS_CHECKED")
        with tempfile.TemporaryDirectory() as folder:
            json_path, markdown_path = write_files(Path(folder), thesis)
            self.assertEqual(json.loads(json_path.read_text())["thesis_id"], thesis["thesis_id"])
            self.assertIn("DEMO", markdown_path.read_text())

    def test_thin_liquidity_and_a_young_pair_are_raised_from_the_row(self):
        thesis = write_thesis(
            _signal(),
            _record(liquidity_usd=1_000, volume_h1=20_000, price_change_h1=-90, pair_created_at_ms=90_000_000 - 1_000),
            now_ms=90_000_000,
        )
        flags = {item["flag"]: item["status"] for item in thesis["risk_flags"]}
        self.assertEqual(flags["LIQUIDITY"], "RAISED")
        self.assertEqual(flags["VOLUME_ANOMALY"], "RAISED")
        self.assertEqual(flags["PAIR_AGE"], "RAISED")
        self.assertTrue(thesis["bear_case"])
        self.assertFalse(thesis["proposal"]["not_an_order"] is False)

    def test_missing_key_does_not_call_a_provider(self):
        with patch.dict("os.environ", {"ZOORA_MODEL_API_KEY": "", "ZOORA_MODEL_PROVIDER": "", "ZOORA_MODEL_NAME": ""}, clear=False):
            thesis = write_thesis(_signal(), _record(), now_ms=90_000_000)
        self.assertEqual(thesis["narrative_source"], "DETERMINISTIC_FIELDS")


class PaperTests(unittest.TestCase):
    def test_open_stop_timeout_and_metrics(self):
        thesis = write_thesis(_signal(), _record(liquidity_usd=50_000), now_ms=1_000, threshold_ppm=600_000)
        self.assertEqual(assumed_slippage_bps(50_000), 5)
        with tempfile.TemporaryDirectory() as folder:
            ledger = Path(folder) / "paper.jsonl"
            opened = open_position(ledger, thesis, mark_price_usd=1.0, now_ms=1_000, notional_usd=100)
            self.assertGreater(opened["entry_fill_usd"], 1.0)
            self.assertTrue(open_position(ledger, thesis, mark_price_usd=1.0, now_ms=1_000, notional_usd=100)["replayed"])
            still = mark(ledger, thesis["thesis_id"], mark_price_usd=1.05, now_ms=1_100)
            self.assertEqual(still["status"], "OPEN")
            closed = mark(ledger, thesis["thesis_id"], mark_price_usd=0.5, now_ms=1_200)
            self.assertEqual(closed["reason"], "STOP")
            self.assertLess(closed["pnl_usd"], 0)
            self.assertEqual(closed["attribution_usd"]["flyvis"], 0)
            self.assertEqual(closed["attribution_usd"]["tape"], 0)
            self.assertEqual(closed["attribution_usd"]["hemibrain"], 0)
            self.assertAlmostEqual(closed["attribution_usd"]["crow"], closed["pnl_usd"])
            report = metrics(ledger)
            self.assertEqual(report["closed"], 1)
            self.assertEqual(report["win_rate"], 0)
            self.assertLess(report["avg_r"], 0)
            self.assertEqual(report["live_orders"], False)

    def test_take_profit_then_timeout_drawdown(self):
        winner = write_thesis(_signal(), _record(), now_ms=0)
        loser = write_thesis(_signal(score=710_000), _record(token_address="Mint222", symbol="OTHER"), now_ms=0)
        with tempfile.TemporaryDirectory() as folder:
            ledger = Path(folder) / "paper.jsonl"
            open_position(ledger, winner, mark_price_usd=1.0, now_ms=0, notional_usd=100)
            first = mark(ledger, winner["thesis_id"], mark_price_usd=5, now_ms=10)
            self.assertEqual(first["reason"], "TAKE_PROFIT")
            self.assertGreater(first["pnl_usd"], 0)
            open_position(ledger, loser, mark_price_usd=1.0, now_ms=20, notional_usd=100)
            second = mark(ledger, loser["thesis_id"], mark_price_usd=0.9, now_ms=20 + winner["horizon_ms"])
            self.assertEqual(second["reason"], "TIMEOUT")
            report = metrics(ledger)
            self.assertEqual(report["closed"], 2)
            self.assertEqual(report["win_rate"], 0.5)
            self.assertGreater(report["max_drawdown_usd"], 0)
            self.assertGreater(report["attribution_usd"]["crow"], report["attribution_usd"]["flyvis"])
            self.assertEqual(report["attribution_usd"]["hemibrain"], 0)
            self.assertEqual(report["attribution_usd"]["tape"], 0)


class SnapshotTests(unittest.TestCase):
    def test_reader_uses_dex_pair_rows_and_refuses_other_urls(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            day = root / "snapshots" / "2026-11-04"
            day.mkdir(parents=True)
            relative = "snapshots/2026-11-04/0525.jsonl"
            rows = [
                {"source": "dexscreener_token_profiles_latest", "chain": "solana", "token_address": "A", "ts": "2026-11-04T05:25:01+00:00"},
                _record(token_address="A", liquidity_usd=10, price_usd=2),
                _record(token_address="A", liquidity_usd=40, price_usd=3),
                _record(token_address="B", liquidity_usd=5, price_usd=0.5),
            ]
            (day / "0525.jsonl").write_text("".join(json.dumps(row) + "\n" for row in rows))
            (root / "latest.json").write_text(json.dumps({
                "ts": "2026-11-04T05:25:01+00:00",
                "snapshot_file": relative,
                "record_count": 4,
                "sources": {"dexscreener_pairs": {"ok": True, "records": 3}},
            }))
            loaded = load_snapshot(root)
            pairs = canonical_pairs(loaded)
            self.assertEqual(pairs["A"]["price_usd"], 3)
            observed = observation_from_pair(pairs["B"], {"price_usd": 0.4, "liquidity_usd": 5})
            self.assertEqual(observed["previous_price"], 0.4)
            self.assertEqual(observed["action"], "NO_EXECUTION")
            self.assertEqual(load_latest(root)["record_count"], 4)
        with self.assertRaises(SnapshotError):
            fetch_json("https://evil.example/tokens/v1/solana/Mint")
        with self.assertRaises(SnapshotError):
            fetch_json("http://api.dexscreener.com/tokens/v1/solana/Mint")
        payload = fetch_pair_metrics(["Mint111"], transport=lambda url: [{
            "chainId": "solana",
            "pairAddress": "Pair111",
            "dexId": "raydium",
            "priceUsd": "1.25",
            "baseToken": {"address": "Mint111", "symbol": "DEMO"},
            "liquidity": {"usd": 1000},
            "volume": {"h1": 50},
            "priceChange": {"h1": -4},
            "txns": {"h1": {"buys": 2, "sells": 3}},
            "pairCreatedAt": 10,
        }])
        self.assertEqual(payload[0]["price_usd"], 1.25)
        self.assertEqual(payload[0]["source"], "dexscreener_pairs")
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / "data"
            day = root / "snapshots" / "2026-11-04"
            day.mkdir(parents=True)
            first = _record(ts="2026-11-04T05:20:01+00:00", fetched_at="2026-11-04T05:20:01+00:00")
            second = _record(ts="2026-11-04T05:25:01+00:00", fetched_at="2026-11-04T05:25:01+00:00", price_usd=0.5)
            (day / "0520.jsonl").write_text(json.dumps(first) + "\n")
            (day / "0525.jsonl").write_text(json.dumps(second) + "\n")
            (root / "latest.json").write_text(json.dumps({"snapshot_file": "snapshots/2026-11-04/0525.jsonl", "sources": {}}))
            result = replay(
                root, root / "paper.jsonl", root / "theses",
                score=lambda observation, now_ms: _signal(),
            )
            self.assertEqual(result["opened"], 1)
            self.assertEqual(result["closed"], 1)
            self.assertEqual(result["live_orders"], False)
            self.assertTrue(any((root / "theses").glob("*.md")))

    def test_replay_scores_only_after_the_cut_and_keeps_earlier_prices(self):
        seen = []

        def score(observation, now_ms):
            seen.append(observation)
            return _signal()

        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / "data"
            day = root / "snapshots" / "2026-11-04"
            day.mkdir(parents=True)
            first = _record(ts="2026-11-04T05:20:01+00:00", fetched_at="2026-11-04T05:20:01+00:00", price_usd=1.0)
            second = _record(ts="2026-11-04T05:25:01+00:00", fetched_at="2026-11-04T05:25:01+00:00", price_usd=0.5)
            (day / "0520.jsonl").write_text(json.dumps(first) + "\n")
            (day / "0525.jsonl").write_text(json.dumps(second) + "\n")
            (root / "latest.json").write_text(json.dumps({"snapshot_file": "snapshots/2026-11-04/0525.jsonl", "sources": {}}))
            result = replay(
                root, root / "paper.jsonl", root / "theses",
                score=score, not_before_ms=parse_time_ms(second["ts"]),
            )
            self.assertEqual(len(seen), 1)
            self.assertEqual(seen[0]["previous_price"], 1.0)
            self.assertEqual([point["price_usd"] for point in seen[0]["fly_history"]], [1.0, 0.5])
            self.assertEqual(result["opened"], 1)
            self.assertEqual(result["closed"], 0)
            self.assertFalse(result["live_orders"])
        with patch("src.multi_brain_research.snapshot_feed.build_opener") as opener:
            fetch_json("https://api.dexscreener.com/tokens/v1/solana/Mint", transport=lambda url: [])
            opener.assert_not_called()


class RiskTests(unittest.TestCase):
    def test_each_limit_rejects_before_a_send_and_the_stub_stays_disabled(self):
        quiet = {"open_positions": 0, "daily_loss_usd": 0}
        self.assertEqual(enforce(_order(notional_usd=100), quiet, _config())["reasons"], ["MAX_POSITION"])
        self.assertIn("KILL_SWITCH", enforce(_order(), quiet, _config(kill_switch=True))["reasons"])
        self.assertIn("TOKEN_NOT_ALLOWLISTED", enforce(_order(mint="Other"), quiet, _config())["reasons"])
        self.assertIn("VENUE_NOT_ALLOWLISTED", enforce(_order(venue="jupiter"), quiet, _config())["reasons"])
        self.assertIn("MAX_OPEN_POSITIONS", enforce(_order(), {"open_positions": 2, "daily_loss_usd": 0}, _config())["reasons"])
        self.assertIn("MAX_DAILY_LOSS", enforce(_order(), {"open_positions": 0, "daily_loss_usd": 50}, _config())["reasons"])
        passed = enforce(_order(), quiet, _config())
        self.assertTrue(passed["allowed"])
        self.assertFalse(passed["sent"])
        self.assertFalse(live_opt_in({}, _config(live_enabled=True)))
        self.assertFalse(live_opt_in({ENV_FLAG: LIVE_VALUE}, _config(live_enabled=False)))
        adapter = LiveAdapter(env={ENV_FLAG: LIVE_VALUE, ENV_CONFIG: ""}, config=_config(live_enabled=True, kill_switch=False))
        refused = adapter.submit(_order(), quiet)
        self.assertEqual(refused["reasons"], ["LIVE_ADAPTER_NOT_IMPLEMENTED"])
        self.assertFalse(refused["sent"])
        self.assertFalse(refused["execution_allowed"])
        missing = LiveAdapter(env={}, config=None).submit(_order(), quiet)
        self.assertEqual(missing["reasons"], ["LIVE_CONFIG_ABSENT"])
        disabled = LiveAdapter(env={}, config=_config(live_enabled=True)).submit(_order(), quiet)
        self.assertEqual(disabled["reasons"], ["LIVE_DISABLED"])
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "live.json"
            path.write_text(json.dumps(_config(private_key="never")))
            with self.assertRaises(ExecutionError):
                load_config(path)
            path.write_text(json.dumps(_config(live_enabled=True)))
            loaded = load_config(path)
            self.assertTrue(live_opt_in({ENV_FLAG: LIVE_VALUE}, loaded))
            self.assertFalse(LiveAdapter({ENV_FLAG: LIVE_VALUE}, loaded).submit(_order(), quiet)["sent"])


if __name__ == "__main__":
    unittest.main()
