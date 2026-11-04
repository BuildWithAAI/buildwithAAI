"""Ladder E exits on recorded candles and snapshot rows. No network and no live order."""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from src.multi_brain_research.paper_trader import (
    FEE_RATE,
    SLIPPAGE_RATE,
    _sell_fill,
    mark,
    metrics,
    open_position,
    state,
)
from src.multi_brain_research.pool_ohlcv import parse_ohlcv
from src.multi_brain_research.thesis import write_thesis

CANDLES = Path(__file__).resolve().parent / "fixtures" / "giant-brain-ohlcv" / "veto-minute.json"
SNAPSHOT = Path(__file__).resolve().parent / "fixtures" / "giant-brain-time-gate" / "snapshots" / "2026-11-04"


def _candles():
    rows = parse_ohlcv(json.loads(CANDLES.read_text(encoding="utf-8")))
    rows.sort(key=lambda item: item["ts_ms"])
    return rows


def _row(name: str) -> dict:
    return json.loads((SNAPSHOT / name).read_text(encoding="utf-8"))


def _thesis(record, now_ms: int):
    signal = {
        "fused_score_ppm": 700_000,
        "confidence_ppm": 1,
        "mint": record["token_address"],
        "brains": {
            "flyvis": {"paper_long_support_ppm": 700_000, "detail": "FLASH_KERNEL_READOUT", "council_member": True, "primary": True},
        },
        "provenance": {"observation_sha256": "cd" * 32},
        "action": "NO_EXECUTION",
        "execution_allowed": False,
    }
    return write_thesis(signal, record, now_ms=now_ms, threshold_ppm=600_000)


class LadderExitTests(unittest.TestCase):
    def test_a_real_candle_low_stops_the_full_position_before_any_rung(self):
        candle = _candles()[10]
        self.assertLess(candle["high"] / candle["low"], 4)
        entry = candle["low"] / 0.5
        record = _row("0515.jsonl")
        record["price_usd"] = entry
        with tempfile.TemporaryDirectory() as folder:
            ledger = Path(folder) / "paper.jsonl"
            thesis = _thesis(record, candle["ts_ms"])
            opened = open_position(ledger, thesis, mark_price_usd=entry, now_ms=candle["ts_ms"], notional_usd=100)
            self.assertEqual(opened["exit_policy"], "ladder_e")
            self.assertEqual(opened["fill_model"], "FEE_1PCT_SLIP_0_5PCT")
            self.assertEqual(opened["graduation"], "NOT_OBSERVED")
            self.assertEqual(opened["trail_pct"], 0.40)
            self.assertEqual(opened["stop_multiple"], 0.5)
            self.assertEqual(opened["remaining_fraction"], 1.0)
            self.assertIsNone(opened["tp_levels"][0]["filled_at"])
            closed = mark(
                ledger, thesis["thesis_id"], mark_price_usd=entry, now_ms=candle["ts_ms"] + 60_000, candles=[candle],
            )
            self.assertEqual(closed["reason"], "STOP")
            self.assertEqual(closed["price_path"], "MINUTE_CANDLE")
            self.assertEqual(closed["fill_model"], "FEE_1PCT_SLIP_0_5PCT")
            self.assertEqual(closed["fees"], "APPLIED")
            self.assertIsNone(closed["tp_levels"][0]["fill_price"])
            self.assertEqual(closed["remaining_fraction"], 0.0)
            self.assertLess(closed["pnl_after_costs_usd"], 0)
            self.assertFalse(closed["live_orders"])

    def test_real_veto_high_fills_the_2x_rung_and_a_later_low_trails_only_the_20_percent_setting(self):
        candles = _candles()
        first = next(item for item in candles if item["ts_ms"] == 1793776500 * 1000)
        later = next(item for item in candles if item["ts_ms"] == 1793776920 * 1000)
        entry = first["high"] / 2
        self.assertGreater(later["low"], first["high"] * 0.6)
        self.assertLessEqual(later["low"], first["high"] * 0.8)
        record = _row("0520.jsonl")
        record["price_usd"] = entry
        record["instant_graduation"] = True
        with tempfile.TemporaryDirectory() as folder:
            ledger = Path(folder) / "paper.jsonl"
            thesis = _thesis(record, first["ts_ms"])
            opened = open_position(
                ledger, thesis, mark_price_usd=entry, now_ms=first["ts_ms"], notional_usd=100, instant_graduation=True,
            )
            self.assertEqual(opened["trail_pct"], 0.20)
            self.assertEqual(opened["graduation"], "INSTANT")
            self.assertEqual([level["fraction"] for level in opened["tp_levels"]], [0.5, 0.25])
            marked = mark(
                ledger, thesis["thesis_id"], mark_price_usd=entry, now_ms=first["ts_ms"] + 60_000, candles=[first],
            )
            self.assertEqual(marked["type"], "UPDATE")
            self.assertEqual(marked["tp_levels"][0]["fill_price"], first["high"])
            self.assertEqual(marked["tp_levels"][0]["filled_at"], first["ts_ms"])
            self.assertIsNone(marked["tp_levels"][1]["filled_at"])
            self.assertAlmostEqual(marked["remaining_fraction"], 0.5)
            self.assertEqual(marked["running_high"], first["high"])
            partial = [json.loads(line) for line in ledger.read_text().splitlines() if '"PARTIAL"' in line][0]
            expected = (_sell_fill(first["high"]) - opened["entry_fill_usd"]) * opened["quantity"] * 0.5
            self.assertAlmostEqual(partial["partial_pnl_usd"], expected)
            self.assertEqual(partial["fee_rate"], FEE_RATE)
            self.assertEqual(partial["slippage_rate"], SLIPPAGE_RATE)
            trailed = mark(
                ledger, thesis["thesis_id"], mark_price_usd=later["close"], now_ms=later["ts_ms"] + 60_000,
                candles=[first, later],
            )
            self.assertEqual(trailed["reason"], "TRAIL")
            self.assertEqual(trailed["price_path"], "MINUTE_CANDLE")
            self.assertAlmostEqual(trailed["exit_raw_usd"], first["high"] * 0.8)
            self.assertIsNone(trailed["tp_levels"][1]["filled_at"])
            self.assertAlmostEqual(trailed["pnl_usd"], trailed["pnl_after_costs_usd"])
            self.assertGreater(trailed["pnl_after_costs_usd"], 0)
            self.assertEqual(state(ledger)["open"], {})
            wide = Path(folder) / "wide.jsonl"
            wide_open = open_position(
                wide, thesis, mark_price_usd=entry, now_ms=first["ts_ms"], notional_usd=100, instant_graduation=False,
            )
            self.assertEqual(wide_open["trail_pct"], 0.40)
            self.assertEqual(wide_open["graduation"], "STANDARD")
            mark(wide, thesis["thesis_id"], mark_price_usd=entry, now_ms=first["ts_ms"] + 60_000, candles=[first])
            held = mark(
                wide, thesis["thesis_id"], mark_price_usd=later["close"], now_ms=later["ts_ms"] + 60_000,
                candles=[first, later],
            )
            self.assertEqual(held["type"], "UPDATE")
            self.assertAlmostEqual(held["remaining_fraction"], 0.5)
            self.assertEqual(held["status"], "OPEN")

    def test_snapshot_rows_leave_the_ladder_open_and_raise_the_running_high(self):
        rows = [_row(name) for name in ("0515.jsonl", "0520.jsonl", "0525.jsonl")]
        prices = [row["price_usd"] for row in rows]
        with tempfile.TemporaryDirectory() as folder:
            ledger = Path(folder) / "paper.jsonl"
            thesis = _thesis(rows[0], 1_793_769_303_000)
            opened = open_position(ledger, thesis, mark_price_usd=prices[0], now_ms=1_793_769_303_000, notional_usd=100)
            self.assertIsNone(opened["instant_graduation"])
            for price, stamp in zip(prices[1:], (1_793_769_601_000, 1_793_769_901_000)):
                marked = mark(ledger, thesis["thesis_id"], mark_price_usd=price, now_ms=stamp)
                self.assertEqual(marked["type"], "UPDATE")
                self.assertEqual(marked["price_path"], "SNAPSHOT_MARK")
            book = state(ledger)
            self.assertEqual(book["closed"], [])
            position = next(iter(book["open"].values()))
            self.assertEqual(position["running_high"], max(prices))
            self.assertEqual(position["remaining_fraction"], 1.0)
            self.assertEqual(position["realized_partial_pnl_usd"], 0.0)
            report = metrics(ledger)
            self.assertEqual(report["closed"], 0)
            self.assertIsNone(report["win_rate_after_costs"])
            self.assertIsNone(report["avg_win"])
            self.assertIsNone(report["avg_loss"])
            self.assertIsNone(report["pl_ratio"])
            self.assertIsNone(report["profit_factor"])
            self.assertIsNone(report["pnl_after_costs"])
            timed = mark(
                ledger, thesis["thesis_id"], mark_price_usd=prices[-1],
                now_ms=1_793_769_303_000 + 48 * 60 * 60 * 1000,
            )
            self.assertEqual(timed["reason"], "TIMEOUT")
            self.assertEqual(timed["price_path"], "SNAPSHOT_MARK")
            self.assertEqual(timed["fees"], "APPLIED")
            self.assertAlmostEqual(timed["pnl_usd"], timed["pnl_after_costs_usd"])


if __name__ == "__main__":
    unittest.main()
