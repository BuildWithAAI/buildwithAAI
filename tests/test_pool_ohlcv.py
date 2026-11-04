"""Recorded GeckoTerminal candles decide paper stop and target. No network."""
from __future__ import annotations

import io
import json
import tempfile
import unittest
import urllib.error
from email.message import Message
from pathlib import Path

from src.multi_brain_research.paper_trader import _candle_exit, mark, open_position
from src.multi_brain_research.pool_ohlcv import fetch_ohlcv, load_jsonl, ohlcv_url, parse_ohlcv, write_jsonl
from src.multi_brain_research.snapshot_feed import SnapshotError, fetch_json, parse_time_ms
from src.multi_brain_research.thesis import write_thesis
from src.multi_brain_research.watch import replay

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "giant-brain-ohlcv" / "veto-minute.json"


def _candles():
    return parse_ohlcv(json.loads(FIXTURE.read_text(encoding="utf-8")))


def _position(candle, stop, target, *, opened_ms=None, horizon_ms=60_000):
    start = candle["ts_ms"] if opened_ms is None else opened_ms
    return {
        "opened_ms": start,
        "horizon_ms": horizon_ms,
        "stop_price_usd": stop,
        "take_profit_price_usd": target,
    }


class ParseTests(unittest.TestCase):
    def test_the_recorded_veto_page_is_newest_first_and_parses_in_time_order(self):
        payload = json.loads(FIXTURE.read_text(encoding="utf-8"))
        raw = payload["data"]["attributes"]["ohlcv_list"]
        self.assertGreater(raw[0][0], raw[-1][0])
        candles = parse_ohlcv(payload)
        self.assertEqual(len(candles), len(raw))
        self.assertLess(candles[0]["ts_ms"], candles[-1]["ts_ms"])
        self.assertEqual(candles[0]["ts_ms"], raw[-1][0] * 1000)
        self.assertEqual(candles[-1]["high"], raw[0][1 + 1])
        self.assertEqual(ohlcv_url(
            "Dok34bZDNVEaijtsEoNXWcQWamEzp5iFN9ZsjjvtjQZq", before_timestamp=1793777600, limit=20,
        ), "https://api.geckoterminal.com/api/v2/networks/solana/pools/Dok34bZDNVEaijtsEoNXWcQWamEzp5iFN9ZsjjvtjQZq/ohlcv/minute?aggregate=1&limit=20&currency=usd&token=base&before_timestamp=1793777600")

    def test_a_short_row_is_skipped_and_a_bad_envelope_is_refused(self):
        payload = json.loads(FIXTURE.read_text(encoding="utf-8"))
        payload["data"]["attributes"]["ohlcv_list"] = [["nope"], payload["data"]["attributes"]["ohlcv_list"][0]]
        self.assertEqual(len(parse_ohlcv(payload)), 1)
        with self.assertRaises(SnapshotError):
            parse_ohlcv({"data": {}})

    def test_other_hosts_are_refused_and_a_429_backs_off_without_a_price(self):
        with self.assertRaises(SnapshotError):
            fetch_json("https://evil.example/api/v2/networks/solana/pools/x/ohlcv/minute")
        headers = Message()
        headers["Retry-After"] = "1"
        sleeps = []

        def transport(url):
            if sleeps:
                return json.loads(FIXTURE.read_text(encoding="utf-8"))
            sleeps.append(url)
            raise urllib.error.HTTPError(url, 429, "Too Many Requests", headers, io.BytesIO(b""))

        result = fetch_ohlcv(
            "Dok34bZDNVEaijtsEoNXWcQWamEzp5iFN9ZsjjvtjQZq",
            before_timestamp=1793777600,
            limit=20,
            transport=transport,
            sleep=lambda seconds: sleeps.append(seconds),
            attempts=2,
        )
        self.assertEqual(result["status"], "OBSERVED")
        self.assertEqual(sleeps[1], 1)
        self.assertGreater(len(result["candles"]), 0)
        refused = fetch_ohlcv(
            "Dok34bZDNVEaijtsEoNXWcQWamEzp5iFN9ZsjjvtjQZq",
            before_timestamp=1793777600,
            transport=lambda url: (_ for _ in ()).throw(urllib.error.HTTPError(url, 429, "Too Many Requests", headers, io.BytesIO(b""))),
            sleep=lambda seconds: None,
            attempts=1,
        )
        self.assertEqual(refused["reason"], "RATE_LIMITED")
        self.assertEqual(refused["candles"], [])


class PathTests(unittest.TestCase):
    def test_stop_wins_when_one_recorded_candle_prints_both_levels(self):
        candle = _candles()[3]
        decision = _candle_exit(
            _position(candle, candle["low"], candle["high"]),
            [candle],
            candle["ts_ms"] + 60_000,
        )
        self.assertEqual(decision[0], "STOP")
        self.assertEqual(decision[1], candle["low"])
        self.assertEqual(decision[2], "STOP_FIRST_SAME_CANDLE")

    def test_target_stop_and_a_miss_use_the_recorded_high_and_low(self):
        candles = _candles()
        candle = min(candles, key=lambda item: item["high"])
        highest = max(item["high"] for item in candles)
        self.assertLess(candle["high"], highest)
        target_only = _candle_exit(
            _position(candle, 0, candle["high"]),
            [candle],
            candle["ts_ms"] + 60_000,
        )
        self.assertEqual(target_only[0], "TAKE_PROFIT")
        self.assertEqual(target_only[2], "CANDLE_HIGH")
        stop_only = _candle_exit(
            _position(candle, candle["low"], highest),
            [candle],
            candle["ts_ms"] + 60_000,
        )
        self.assertEqual(stop_only[0], "STOP")
        self.assertEqual(stop_only[2], "CANDLE_LOW")
        missed = _candle_exit(
            _position(candle, 0, highest),
            [candle],
            candle["ts_ms"] + 60_000,
        )
        self.assertEqual(missed[0], "TIMEOUT")
        self.assertEqual(missed[2], "CANDLES_OBSERVED_NO_HIT")
        unseen = _candle_exit(
            _position(candle, candle["low"], candle["high"], opened_ms=candle["ts_ms"] + 120_000),
            [candle],
            candle["ts_ms"] + 180_000,
        )
        self.assertEqual(unseen[0], "PATH_UNOBSERVED")
        self.assertEqual(unseen[2], "NO_CANDLE_IN_WINDOW")

    def test_a_candle_file_closes_a_paper_long_at_the_stop_before_the_snapshot_timeout(self):
        opened_ms = parse_time_ms("2026-11-04T07:25:01+00:00")
        closed_ms = parse_time_ms("2026-11-04T07:30:01+00:00")
        candle = next(item for item in _candles() if opened_ms <= item["ts_ms"] and item["ts_ms"] + 60_000 <= closed_ms)
        signal = {
            "fused_score_ppm": 700_000,
            "confidence_ppm": 1,
            "mint": "Mint1111111111111111111111111111111111",
            "brains": {"flyvis": {"paper_long_support_ppm": 700_000, "detail": "FLASH_KERNEL_READOUT", "council_member": True, "primary": True}},
            "provenance": {"observation_sha256": "ab" * 32},
            "action": "NO_EXECUTION",
            "execution_allowed": False,
        }
        record = {
            "source": "dexscreener_pairs",
            "chain": "solana",
            "token_address": "Mint1111111111111111111111111111111111",
            "symbol": "DEMO",
            "pair_address": "Dok34bZDNVEaijtsEoNXWcQWamEzp5iFN9ZsjjvtjQZq",
            "dex": "pumpswap",
            "price_usd": 1.0,
            "liquidity_usd": 50_000.0,
            "volume_h1": 1_000.0,
            "price_change_h1": 20.0,
            "buys_h1": 3,
            "sells_h1": 1,
            "pair_created_at_ms": 1_000,
            "fetched_at": "2026-11-04T07:25:01+00:00",
        }
        thesis = write_thesis(signal, record, now_ms=opened_ms, threshold_ppm=600_000, horizon_ms=300_000)
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            ledger = root / "paper.jsonl"
            opened = open_position(ledger, thesis, mark_price_usd=1.0, now_ms=opened_ms, notional_usd=100)
            self.assertEqual(opened["pair_address"], record["pair_address"])
            closed = mark(
                ledger, thesis["thesis_id"], mark_price_usd=1.05, now_ms=closed_ms, candles=[candle],
            )
            self.assertEqual(closed["reason"], "STOP")
            self.assertEqual(closed["path"], "CANDLE_LOW")
            self.assertEqual(closed["fees"], "NOT_OBSERVED")
            self.assertFalse(closed["execution_allowed"])
            self.assertFalse(closed["live_orders"])
            candle_dir = root / "candles"
            write_jsonl(candle_dir / (record["pair_address"] + ".jsonl"), {"status": "OBSERVED", "url": "https://api.geckoterminal.com/api/v2/networks/solana/pools/x/ohlcv/minute", "candles": [candle]}, pool=record["pair_address"], fetched_at="2026-11-04T12:11:48Z")
            self.assertEqual(load_jsonl(candle_dir / (record["pair_address"] + ".jsonl"))[0]["low"], candle["low"])
            day = root / "snapshots" / "2026-11-04"
            day.mkdir(parents=True)
            first = dict(record, ts="2026-11-04T07:25:01+00:00")
            second = dict(record, ts="2026-11-04T07:30:01+00:00", fetched_at="2026-11-04T07:30:01+00:00", price_usd=1.05)
            (day / "0725.jsonl").write_text(json.dumps(first) + "\n")
            (day / "0730.jsonl").write_text(json.dumps(second) + "\n")
            (root / "latest.json").write_text(json.dumps({"snapshot_file": "snapshots/2026-11-04/0730.jsonl", "sources": {}}))
            result = replay(
                root, root / "replay.jsonl", root / "theses",
                score=lambda observation, now_ms: signal,
                candle_dir=candle_dir,
            )
            self.assertEqual(result["opened"], 1)
            self.assertEqual(result["closed"], 1)
            self.assertFalse(result["live_orders"])
            last = json.loads((root / "replay.jsonl").read_text().splitlines()[-1])
            self.assertEqual(last["reason"], "STOP")
            self.assertEqual(last["path"], "CANDLE_LOW")


if __name__ == "__main__":
    unittest.main()
