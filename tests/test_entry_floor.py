"""Gap fills and the dust entry floor, using the recorded GDA rows. No live order."""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from src.multi_brain_research.paper_trader import entry_skip_reasons, mark, open_position
from src.multi_brain_research.pool_ohlcv import load_jsonl
from src.multi_brain_research.snapshot_feed import parse_time_ms
from src.multi_brain_research.thesis import write_thesis
from src.multi_brain_research.watch import replay

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "giant-brain-gda"
CLEAN = Path(__file__).resolve().parent / "fixtures" / "giant-brain-time-gate" / "snapshots" / "2026-11-04" / "0515.jsonl"


def _row(name: str) -> dict:
    return json.loads((FIXTURE / name).read_text(encoding="utf-8"))


def _thesis(record: dict):
    signal = {
        "fused_score_ppm": 700_000,
        "confidence_ppm": 1,
        "mint": record["token_address"],
        "brains": {"flyvis": {"paper_long_support_ppm": 700_000, "detail": "FLASH_KERNEL_READOUT", "council_member": True, "primary": True}},
        "provenance": {"observation_sha256": "ef" * 32},
        "action": "NO_EXECUTION",
        "execution_allowed": False,
    }
    return write_thesis(signal, record, now_ms=parse_time_ms(record["ts"]), threshold_ppm=600_000)


class GapFillTests(unittest.TestCase):
    def test_snapshot_through_the_stop_fills_at_the_gda_mark(self):
        opened_row = _row("2255.jsonl")
        crashed = _row("2300.jsonl")
        entry = opened_row["price_usd"]
        observed = crashed["price_usd"]
        self.assertLess(observed, entry * 0.5)
        with tempfile.TemporaryDirectory() as folder:
            ledger = Path(folder) / "paper.jsonl"
            thesis = _thesis(opened_row)
            open_position(ledger, thesis, mark_price_usd=entry, now_ms=parse_time_ms(opened_row["ts"]), notional_usd=100)
            closed = mark(ledger, thesis["thesis_id"], mark_price_usd=observed, now_ms=parse_time_ms(crashed["ts"]))
            self.assertEqual(closed["reason"], "STOP")
            self.assertEqual(closed["fill_model"], "GAP_AT_SNAPSHOT_MARK")
            self.assertEqual(closed["price_path"], "SNAPSHOT_MARK")
            self.assertEqual(closed["exit_raw_usd"], observed)
            self.assertAlmostEqual(closed["stop_level_usd"], entry * 0.5)
            self.assertLess(closed["exit_raw_usd"], closed["stop_level_usd"])
            self.assertFalse(closed["live_orders"])

    def test_candle_low_through_the_stop_fills_at_that_low(self):
        opened_row = _row("2255.jsonl")
        entry = opened_row["price_usd"]
        candles = load_jsonl(FIXTURE / "gda-minute.jsonl")
        crash = next(candle for candle in candles if candle["open"] > 1e-4 and candle["low"] < 1e-5)
        self.assertLess(crash["low"], entry * 0.5)
        self.assertGreater(crash["open"], entry * 0.5)
        with tempfile.TemporaryDirectory() as folder:
            ledger = Path(folder) / "paper.jsonl"
            thesis = _thesis(opened_row)
            opened_ms = parse_time_ms(opened_row["ts"])
            open_position(ledger, thesis, mark_price_usd=entry, now_ms=opened_ms, notional_usd=100)
            closed = mark(
                ledger, thesis["thesis_id"], mark_price_usd=crash["close"],
                now_ms=crash["ts_ms"] + 60_000, candles=candles,
            )
            self.assertEqual(closed["reason"], "STOP")
            self.assertEqual(closed["fill_model"], "GAP_AT_CANDLE_LOW")
            self.assertEqual(closed["price_path"], "MINUTE_CANDLE")
            self.assertEqual(closed["exit_raw_usd"], crash["low"])
            self.assertLess(closed["exit_raw_usd"], closed["stop_level_usd"])


class EntryFloorTests(unittest.TestCase):
    def test_gda_dust_row_is_skipped_and_a_large_row_is_not(self):
        dust = _row("2310.jsonl")
        self.assertEqual(dust["symbol"], "GDA")
        self.assertEqual(
            entry_skip_reasons(dust),
            ["LIQUIDITY_BELOW_MIN", "MARKET_CAP_BELOW_MIN", "HOUR_DROP_OVER_LIMIT"],
        )
        healthy = _row("2255.jsonl")
        self.assertEqual(entry_skip_reasons(healthy), [])
        si = json.loads(CLEAN.read_text(encoding="utf-8"))
        self.assertEqual(entry_skip_reasons(si), [])
        touched = dict(dust)
        touched["price_change_h1"] = -80
        self.assertNotIn("HOUR_DROP_OVER_LIMIT", entry_skip_reasons(touched))
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            day = root / "snapshots" / "2026-11-04"
            day.mkdir(parents=True)
            (day / "2310.jsonl").write_text((FIXTURE / "2310.jsonl").read_text(encoding="utf-8"))
            (root / "latest.json").write_text(json.dumps({"snapshot_file": "snapshots/2026-11-04/2310.jsonl", "sources": {}}))
            signal = {
                "fused_score_ppm": 700_000,
                "confidence_ppm": 1,
                "mint": dust["token_address"],
                "brains": {"flyvis": {"paper_long_support_ppm": 700_000, "detail": "FLASH_KERNEL_READOUT", "council_member": True, "primary": True}},
                "provenance": {"observation_sha256": "ef" * 32},
                "action": "NO_EXECUTION",
                "execution_allowed": False,
            }
            result = replay(root, root / "paper.jsonl", root / "theses", score=lambda observation, now_ms: signal, limit=25)
            self.assertEqual(result["opened"], 0)
            self.assertEqual(result["entry_skipped"], 1)
            self.assertEqual(
                result["skip_reasons"],
                {"LIQUIDITY_BELOW_MIN": 1, "MARKET_CAP_BELOW_MIN": 1, "HOUR_DROP_OVER_LIMIT": 1},
            )
            skipped = json.loads((root / "paper.jsonl").read_text().splitlines()[-1])
            self.assertEqual(skipped["type"], "SKIP")
            self.assertEqual(skipped["symbol"], "GDA")
            self.assertEqual(skipped["market_cap_usd"], 1943.0)
            self.assertEqual(skipped["liquidity_usd"], 1986.8)
            self.assertEqual(skipped["price_change_h1"], -94.84)
            self.assertFalse(skipped["execution_allowed"])
            self.assertFalse(result["live_orders"])


if __name__ == "__main__":
    unittest.main()
