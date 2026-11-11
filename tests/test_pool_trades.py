"""Pool trades and the causal entry veto.

The trades under tests/fixtures/giant-brain-trades/ are a trimmed
GeckoTerminal page recorded on 2026-11-05. This file does not open a socket.
"""
from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from unittest.mock import patch

from src.multi_brain_research.flow_capture import (
    append_read,
    capture_pool_trades,
    entry_veto_reasons,
    join_flow_read,
    load_flow_reads,
)
from src.multi_brain_research.holder_concentration import interpret
from src.multi_brain_research.pool_trades import (
    LARGE_SELL_SHARE_PPM,
    _http_get,
    fetch_trades,
    flow_features,
    parse_trades,
    trades_url,
    trades_url_ok,
)
from src.multi_brain_research.snapshot_feed import SnapshotError, _allowed_url, parse_time_ms
from src.multi_brain_research.watch import replay

FIXTURE = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "giant-brain-trades"
POOL = "zd8E6E7gm3jNPPziMLS4qS1pvpGweJY4MfCh9wD3Gpp"
MINT = "F49ncWoGVf2EYpg4iqbkhuMvyLRgJYSrTMT3jCUSpump"
OTHER = "B2rbxGL2WZS3wBQm83LoaQJr4QmJFvmUJ2f5VzucDUci"
ENDPOINT = "https://api.mainnet-beta.solana.com"
WHEN = 1_793_860_000_000
SI_MINT = "HMYd9tosnUXuNHmq7pXmoePRVBLBBjA3JBfydq6upump"
SI_PAIR = "12jc1DzJpzbCDaKuM4brAKh9jcFry2TLG1FfGsL4ftCG"


def _recorded():
    return json.loads((FIXTURE / "look-trades-2026-11-05.json").read_text(encoding="utf-8"))


def _supply(amount="1000", slot=10):
    return {"jsonrpc": "2.0", "result": {"context": {"slot": slot}, "value": {
        "amount": amount, "decimals": 6, "uiAmount": None, "uiAmountString": "0",
    }}, "id": 1}


def _largest(amount, slot=10):
    return {"jsonrpc": "2.0", "result": {"context": {"slot": slot}, "value": [
        {"address": "5ZndeMaC36YapnG4UpXsFg2DXDquHw6xEpBXGfmfpump", "amount": str(amount), "decimals": 6, "uiAmount": 0.1, "uiAmountString": "0.1"},
    ]}, "id": 1}


def _holder(amount, read_ts_ms):
    token = {
        "owner": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
        "data": {"parsed": {"type": "account", "info": {
            "mint": SI_MINT,
            "owner": "11111111111111111111111111111111",
            "tokenAmount": {"amount": str(amount), "decimals": 6, "uiAmount": None},
        }}, "program": "spl-token"},
    }
    owner = {"owner": "11111111111111111111111111111111", "data": ["", "base64"], "lamports": 1, "executable": False}
    read = interpret(
        SI_MINT, ENDPOINT, _supply(), _largest(amount),
        token_accounts_payload={"result": {"context": {"slot": 10}, "value": [token]}},
        owner_accounts_payload={"result": {"context": {"slot": 10}, "value": [owner]}},
        pair_address=SI_PAIR,
        fetched_at_ms=read_ts_ms,
    )
    read["read_ts_ms"] = read_ts_ms
    read["read_ts"] = "2026-11-04T05:14:00Z"
    return read


def _flow(share, read_ts_ms, pool=SI_PAIR):
    return {
        "protocol": "AAI_POOL_TRADES_V1",
        "status": "AVAILABLE",
        "reason": None,
        "mint": SI_MINT,
        "pool": pool,
        "source": trades_url(pool),
        "read_ts_ms": read_ts_ms,
        "features": {
            "large_sell_share_ppm": share,
            "largest_sell_usd": "1",
            "rule_large_sell_share_ppm": LARGE_SELL_SHARE_PPM,
        },
        "execution_allowed": False,
        "live_orders": False,
        "action": "NO_EXECUTION",
    }


def _root(folder: Path, record: dict) -> Path:
    root = folder / "data"
    day = root / "snapshots" / "2026-11-04"
    day.mkdir(parents=True)
    (day / "0515.jsonl").write_text(json.dumps(record) + "\n", encoding="utf-8")
    (root / "latest.json").write_text(json.dumps({
        "snapshot_file": "snapshots/2026-11-04/0515.jsonl",
        "sources": {},
    }), encoding="utf-8")
    return root


def _si_record():
    return {
        "source": "dexscreener_pairs",
        "chain": "solana",
        "token_address": SI_MINT,
        "symbol": "SI276",
        "pair_address": SI_PAIR,
        "dex": "pumpswap",
        "price_usd": 0.0004676,
        "liquidity_usd": 68133.42,
        "market_cap": 450102.0,
        "volume_h1": 19274.71,
        "price_change_h1": 0.79,
        "buys_h1": 1560,
        "sells_h1": 845,
        "ts": "2026-11-04T05:15:03+00:00",
        "fetched_at": "2026-11-04T05:15:11+00:00",
    }


def _signal():
    return {
        "fused_score_ppm": 700_000,
        "confidence_ppm": 1,
        "mint": SI_MINT,
        "brains": {"flyvis": {"paper_long_support_ppm": 700_000, "detail": "FLASH_KERNEL_READOUT", "council_member": True, "primary": True}},
        "provenance": {"observation_sha256": "ef" * 32},
        "action": "NO_EXECUTION",
        "execution_allowed": False,
    }


class RecordedTradesTests(unittest.TestCase):
    def test_a_recorded_page_keeps_only_fields_the_body_has(self):
        payload = _recorded()
        trades, skipped = parse_trades(payload)
        self.assertEqual(skipped, 0)
        self.assertEqual(len(trades), 12)
        features = flow_features(trades)
        buys = [row for row in payload["data"] if row["attributes"]["kind"] == "buy"]
        sells = [row for row in payload["data"] if row["attributes"]["kind"] == "sell"]
        buy_volume = sum(Decimal(row["attributes"]["volume_in_usd"]) for row in buys)
        sell_volume = sum(Decimal(row["attributes"]["volume_in_usd"]) for row in sells)
        largest = max(Decimal(row["attributes"]["volume_in_usd"]) for row in sells)
        total = buy_volume + sell_volume
        expected_share = int((largest * Decimal(1_000_000) / total).to_integral_value(rounding=ROUND_HALF_UP))
        traders = {row["attributes"]["tx_from_address"] for row in payload["data"]}
        self.assertEqual(features["buy_count"], len(buys))
        self.assertEqual(features["sell_count"], len(sells))
        self.assertEqual(features["buy_volume_usd"], format(buy_volume, "f"))
        self.assertEqual(features["sell_volume_usd"], format(sell_volume, "f"))
        self.assertEqual(features["unique_trader_count"], len(traders))
        self.assertLess(features["unique_trader_count"], features["trade_count"])
        self.assertEqual(features["largest_sell_usd"], format(largest, "f"))
        self.assertEqual(features["large_sell_share_ppm"], expected_share)
        self.assertLess(features["large_sell_share_ppm"], LARGE_SELL_SHARE_PPM)
        self.assertEqual(features["anomalous_count"], 0)
        self.assertEqual(features["volume_missing"], 0)
        self.assertEqual(features["window_start"], min(row["attributes"]["block_timestamp"] for row in payload["data"]))
        self.assertEqual(features["window_end"], max(row["attributes"]["block_timestamp"] for row in payload["data"]))
        self.assertEqual(features["rule_large_sell_share_ppm"], 500_000)
        self.assertIsNone(flow_features([])["unique_trader_count"])
        self.assertEqual(flow_features([])["buy_count"], 0)

    def test_a_missing_kind_or_volume_stays_missing(self):
        payload = _recorded()
        bare = json.loads(json.dumps(payload["data"][0]))
        del bare["attributes"]["kind"]
        del bare["attributes"]["volume_in_usd"]
        del bare["attributes"]["tx_from_address"]
        trades, skipped = parse_trades({"data": [bare]})
        self.assertEqual(skipped, 0)
        features = flow_features(trades)
        self.assertIsNone(features["buy_count"])
        self.assertIsNone(features["sell_count"])
        self.assertIsNone(features["buy_volume_usd"])
        self.assertIsNone(features["unique_trader_count"])
        self.assertIsNone(features["large_sell_share_ppm"])

    def test_one_recorded_sell_is_the_whole_page(self):
        payload = _recorded()
        sell = max(payload["data"], key=lambda row: Decimal(row["attributes"]["volume_in_usd"]) if row["attributes"]["kind"] == "sell" else Decimal(0))
        self.assertEqual(sell["attributes"]["kind"], "sell")
        trades, _skipped = parse_trades({"data": [sell]})
        features = flow_features(trades)
        self.assertEqual(features["large_sell_share_ppm"], 1_000_000)
        self.assertEqual(features["sell_count"], 1)
        self.assertEqual(features["buy_count"], 0)
        self.assertGreaterEqual(features["large_sell_share_ppm"], LARGE_SELL_SHARE_PPM)

    def test_the_trades_url_is_allowlisted_and_anything_else_is_refused(self):
        url = trades_url(POOL)
        self.assertEqual(url, f"https://api.geckoterminal.com/api/v2/networks/solana/pools/{POOL}/trades")
        self.assertEqual(_allowed_url(url), url)
        self.assertTrue(trades_url_ok(url, POOL))
        self.assertFalse(trades_url_ok(url + "?foo=1", POOL))
        self.assertFalse(trades_url_ok(url.replace("https://", "http://"), POOL))
        self.assertFalse(trades_url_ok("https://api.geckoterminal.com/api/v2/networks/solana/pools/" + POOL + "/ohlcv/minute"))
        with self.assertRaises(SnapshotError):
            trades_url("not a pool")
        with patch("src.multi_brain_research.pool_trades.build_opener") as opener:
            with self.assertRaises(SnapshotError):
                _http_get("https://evil.example/api/v2/networks/solana/pools/" + POOL + "/trades")
            opener.assert_not_called()

    def test_a_429_waits_once_using_the_collector_cap_and_then_reads_the_recorded_page(self):
        raw = (FIXTURE / "look-trades-2026-11-05.json").read_bytes()
        calls = {"n": 0}
        sleeps = []

        def transport(_url):
            calls["n"] += 1
            if calls["n"] == 1:
                return 429, {"Retry-After": "10"}, b""
            return 200, {}, raw

        result = fetch_trades(POOL, transport=transport, sleep=sleeps.append)
        self.assertEqual(sleeps, [8])
        self.assertEqual(result["status"], "AVAILABLE")
        self.assertEqual(result["retries"], 1)
        self.assertEqual(result["trade_count"], 12)
        self.assertEqual(result["body_sha256"], hashlib.sha256(raw).hexdigest())
        self.assertFalse(result["execution_allowed"])
        self.assertFalse(result["live_orders"])
        sleeps.clear()
        calls["n"] = 0

        def no_header(_url):
            calls["n"] += 1
            if calls["n"] == 1:
                return 429, {}, b""
            return 200, {}, raw

        again = fetch_trades(POOL, transport=no_header, sleep=sleeps.append)
        self.assertEqual(sleeps, [2])
        self.assertEqual(again["status"], "AVAILABLE")
        self.assertEqual(again["retries"], 1)

    def test_a_second_429_is_stored_as_not_observed_and_does_not_invent_flow(self):
        sleeps = []

        def transport(_url):
            return 429, {"Retry-After": "1"}, b""

        result = fetch_trades(POOL, transport=transport, sleep=sleeps.append)
        self.assertEqual(sleeps, [1])
        self.assertEqual(result["status"], "NOT_OBSERVED")
        self.assertEqual(result["reason"], "RATE_LIMITED")
        self.assertEqual(result["http_status"], 429)
        self.assertIsNone(result["features"])
        self.assertIsNone(result["trade_count"])
        self.assertFalse(result["live_orders"])


class CaptureTests(unittest.TestCase):
    def test_pending_capture_is_capped_and_a_fresh_read_is_kept(self):
        record = {
            "source": "dexscreener_pairs",
            "chain": "solana",
            "token_address": MINT,
            "symbol": "Look",
            "pair_address": POOL,
            "volume_h1": 10,
            "ts": "2026-11-05T06:10:02+00:00",
        }
        other = dict(record, token_address="CprMhio8gWydFtxQnySgLkgFrw94UawTy5Ao6rpZpump", symbol="BTC", pair_address=OTHER, volume_h1=9)
        third = dict(record, token_address="9mWrj77gDZ7w4rwHF6STYXDZmYRMyf39L4go1mXepump", symbol="GAVELDROP", pair_address="GgGoctYNusmGdFpqmrC9pv8JX6JPG4mkm4RkeNzkakTo", volume_h1=8)
        raw = (FIXTURE / "look-trades-2026-11-05.json").read_bytes()
        calls = []

        def transport(url):
            calls.append(url)
            return 200, {}, raw

        with tempfile.TemporaryDirectory() as folder:
            root = _root(Path(folder), record)
            path = root / "snapshots" / "2026-11-04" / "0515.jsonl"
            path.write_text("".join(json.dumps(row) + "\n" for row in (record, other, third)), encoding="utf-8")
            summary = capture_pool_trades(root, limit=2, interval_s=0, now_ms=WHEN, transport=transport, pending_only=True)
            self.assertEqual(summary["stored"], 2)
            self.assertEqual(summary["succeeded"], 2)
            self.assertEqual(summary["considered"], 3)
            self.assertEqual(len(calls), 2)
            self.assertFalse(summary["execution_allowed"])
            self.assertFalse(summary["live_orders"])
            loaded = load_flow_reads(root)
            self.assertEqual(set(loaded), {MINT, other["token_address"]})
            row = loaded[MINT][0]
            self.assertEqual(row["read_ts_ms"], WHEN + 1)
            self.assertEqual(row["pool"], POOL)
            self.assertEqual(row["source"], trades_url(POOL))
            self.assertEqual(row["features"]["trade_count"], 12)
            self.assertLess(row["features"]["large_sell_share_ppm"], LARGE_SELL_SHARE_PPM)
            self.assertIsNone(join_flow_read(loaded[MINT], WHEN, POOL))
            self.assertEqual(join_flow_read(loaded[MINT], WHEN + 1, POOL)["status"], "AVAILABLE")
            self.assertIsNone(join_flow_read(loaded[MINT], WHEN + 1, OTHER))
            calls.clear()
            again = capture_pool_trades(root, limit=2, interval_s=0, now_ms=WHEN + 5, transport=transport, pending_only=True)
            self.assertEqual(again["stored"], 1)
            self.assertEqual(again["cached"], 2)
            self.assertEqual(len(calls), 1)
            self.assertEqual(load_flow_reads(root)[third["token_address"]][0]["status"], "AVAILABLE")


class EntryVetoTests(unittest.TestCase):
    def test_a_later_read_does_not_veto_and_a_clear_read_does_not_either(self):
        raised = _holder(600, WHEN)
        clear = _holder(100, WHEN)
        flow = _flow(1_000_000, WHEN)
        late = _flow(1_000_000, WHEN + 1)
        reasons, evidence = entry_veto_reasons(raised, flow, WHEN)
        self.assertEqual(reasons, ["HOLDER_CONCENTRATION_RAISED", "FLOW_LARGE_SELL"])
        self.assertEqual(evidence["compared_share_ppm"], 600_000)
        self.assertEqual(evidence["rule_top10_share_ppm"], 500_000)
        self.assertEqual(evidence["large_sell_share_ppm"], 1_000_000)
        self.assertEqual(evidence["flow_read_ts_ms"], WHEN)
        self.assertEqual(entry_veto_reasons(clear, _flow(499_999, WHEN), WHEN)[0], [])
        self.assertEqual(entry_veto_reasons(raised, late, WHEN)[0], ["HOLDER_CONCENTRATION_RAISED"])
        self.assertEqual(entry_veto_reasons(None, None, WHEN)[0], [])
        missed = dict(flow, status="NOT_OBSERVED", features=None, reason="RATE_LIMITED")
        self.assertEqual(entry_veto_reasons(None, missed, WHEN)[0], [])

    def test_the_veto_skips_a_paper_open_and_stays_off_unless_asked(self):
        record = _si_record()
        decision = parse_time_ms(record["ts"])
        with tempfile.TemporaryDirectory() as folder:
            root = _root(Path(folder), record)
            holder = _holder(600, decision - 1_000)
            line = json.dumps(holder, sort_keys=True)
            day = root / "holder-reads"
            day.mkdir()
            (day / "2026-11-04.jsonl").write_text(line + "\n", encoding="utf-8")
            append_read(root, _flow(1_000_000, decision - 1_000))
            off = replay(root, root / "off.jsonl", root / "theses-off", score=lambda _observation, _now: _signal(), limit=25)
            on = replay(
                root, root / "on.jsonl", root / "theses-on", score=lambda _observation, _now: _signal(),
                limit=25, use_entry_veto=True,
            )
            self.assertEqual(off["opened"], 1)
            self.assertEqual(off["entry_skipped"], 0)
            self.assertEqual(off["entry_veto"], False)
            self.assertEqual(off["flow_joined"], 1)
            self.assertEqual(on["opened"], 0)
            self.assertEqual(on["entry_skipped"], 1)
            self.assertEqual(on["skip_reasons"], {"HOLDER_CONCENTRATION_RAISED": 1, "FLOW_LARGE_SELL": 1})
            skipped = json.loads((root / "on.jsonl").read_text(encoding="utf-8").splitlines()[-1])
            self.assertEqual(skipped["type"], "SKIP")
            self.assertEqual(skipped["veto"]["large_sell_share_ppm"], 1_000_000)
            self.assertEqual(skipped["veto"]["compared_share_ppm"], 600_000)
            self.assertFalse(skipped["execution_allowed"])
            self.assertFalse(on["live_orders"])
            self.assertFalse(on["execution_allowed"])


if __name__ == "__main__":
    unittest.main()
