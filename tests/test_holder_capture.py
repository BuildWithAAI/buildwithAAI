"""Holder capture and the read-time gate.

The Rugcheck bodies and the Solana RPC 429 body under
tests/fixtures/giant-brain-holders/ were recorded on 2026-11-05.
This file does not open a socket.
"""
from __future__ import annotations

import hashlib
import io
import json
import tempfile
import unittest
import urllib.error
from email.message import Message
from pathlib import Path
from unittest.mock import patch

from src.multi_brain_research.giant_brain import fuse
from src.multi_brain_research.holder_capture import _http_get, capture_holders, join_holder_read, load_holder_reads
from src.multi_brain_research.holder_concentration import interpret_rugcheck, rugcheck_url
from src.multi_brain_research.thesis import validate_thesis, write_thesis
from src.multi_brain_research.inventory_gate import CURVE, TOKEN
from src.multi_brain_research.watch import replay

FIXTURE = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "giant-brain-holders"
PIRATE = "2StNe98imN7M6K341a7a4xvc8eNTvLCde5EugAKfLoat"
ZERO = "4DekG14fH6HE6Xe8tHMyU5jei3zeSDCzYRXtsVtZpump"
PIRATE_PAIR = "2ouNPACQVBoDqWJ7Ft6EGhmCGScKpmRzaQn6a9vhKp6D"
ZERO_PAIR = "FH9yNy6LPPtA476zPPgQbyAaGx3DxrJs2FqaA1iJrLc"
ENDPOINT = "https://api.mainnet-beta.solana.com"
WHEN = 1_793_840_000_000


def _ppm(part: int, whole: int) -> int:
    return (part * 1_000_000 + whole // 2) // whole


def _recorded(name: str) -> bytes:
    return (FIXTURE / name).read_bytes()


class RecordedReportTests(unittest.TestCase):
    def test_a_recorded_raydium_report_excludes_the_pool_vault_and_keeps_the_share_in_ppm(self):
        raw = _recorded("pirate-raydium.rugcheck.json")
        payload = json.loads(raw)
        source = rugcheck_url(PIRATE)
        read = interpret_rugcheck(
            PIRATE, payload, source=source, read_ts_ms=WHEN, pair_address=PIRATE_PAIR,
            body_sha256=hashlib.sha256(raw).hexdigest(),
        )
        self.assertEqual(read["status"], "AVAILABLE")
        self.assertEqual(read["source"], source)
        self.assertEqual(read["read_ts_ms"], WHEN)
        self.assertEqual(read["body_sha256"], hashlib.sha256(raw).hexdigest())
        self.assertTrue(read["exclusion_applied"])
        supply = payload["token"]["supply"]
        self.assertEqual(read["supply_atoms"], supply)
        vaults = set()
        for market in payload["markets"]:
            for side, account_key in (("liquidityA", "liquidityAAccount"), ("liquidityB", "liquidityBAccount")):
                account = market.get(account_key) if type(market.get(account_key)) is dict else {}
                if account.get("mint") == PIRATE:
                    vaults.add(market[side])
        self.assertIn("6gz7K6zAfXeHM9hHRjmieEYh4QbjdQ6BHBXhUY3Rm3tJ", vaults)
        labeled = {row["token_account"]: row["classification"] for row in read["accounts"]}
        self.assertEqual(labeled["6gz7K6zAfXeHM9hHRjmieEYh4QbjdQ6BHBXhUY3Rm3tJ"], "POOL_VAULT")
        ordered = sorted(payload["topHolders"], key=lambda item: (-item["amount"], item["address"]))
        raw_top10 = sum(item["amount"] for item in ordered[:10])
        kept = [item for item in ordered if item["address"] not in set(vaults)]
        ex_top10 = sum(item["amount"] for item in kept[:10])
        self.assertEqual(read["top10_share_ppm"], _ppm(raw_top10, supply))
        self.assertEqual(read["top10_ex_vault_share_ppm"], _ppm(ex_top10, supply))
        self.assertLess(read["top10_ex_vault_share_ppm"], read["top10_share_ppm"])
        self.assertNotEqual(read["top1_share_ppm"], read["top1_ex_vault_share_ppm"])
        self.assertIsNone(read["endpoint"])

    def test_a_recorded_pump_curve_owner_is_excluded_from_the_compared_share(self):
        payload = json.loads(_recorded("zero-pumpfun.rugcheck.json"))
        read = interpret_rugcheck(ZERO, payload, source=rugcheck_url(ZERO), read_ts_ms=WHEN, pair_address=ZERO_PAIR)
        self.assertEqual(read["status"], "AVAILABLE")
        curve = next(row for row in read["accounts"] if row["owner"] == ZERO_PAIR)
        self.assertEqual(curve["classification"], "BONDING_CURVE")
        self.assertEqual(curve["classification_reason"], "OWNER_EQUALS_MARKET")
        supply = payload["token"]["supply"]
        ordered = sorted(payload["topHolders"], key=lambda item: (-item["amount"], item["address"]))
        kept = [item for item in ordered if item["owner"] != ZERO_PAIR and item["address"] != payload["markets"][0]["liquidityA"]]
        self.assertEqual(read["top1_ex_vault_atoms"], kept[0]["amount"])
        self.assertEqual(read["top1_ex_vault_share_ppm"], _ppm(kept[0]["amount"], supply))
        self.assertNotIn("uiAmount", json.dumps(read["accounts"]))
        signal = {
            "fused_score_ppm": 700_000,
            "confidence_ppm": 1,
            "mint": ZERO,
            "brains": {"flyvis": {"paper_long_support_ppm": 700_000, "detail": "FLASH_KERNEL_READOUT", "council_member": True}},
            "provenance": {"observation_sha256": "ab" * 32},
            "action": "NO_EXECUTION",
            "execution_allowed": False,
        }
        record = {
            "source": "dexscreener_pairs",
            "token_address": ZERO,
            "symbol": "ZERO",
            "pair_address": ZERO_PAIR,
            "dex": "pumpfun",
            "price_usd": 1.0,
            "liquidity_usd": 50_000.0,
            "volume_h1": 10_000.0,
            "price_change_h1": 20.0,
            "buys_h1": 30,
            "sells_h1": 10,
            "pair_created_at_ms": 1_000,
            "fetched_at": "2026-11-05T02:40:01+00:00",
            "holder_concentration": read,
        }
        thesis = write_thesis(signal, record, now_ms=WHEN)
        validate_thesis(thesis)
        self.assertIn("top-ten holder share", json.dumps(thesis["bull_case"] + thesis["bear_case"]))
        self.assertFalse(thesis["execution_allowed"])
        self.assertFalse(thesis["live_orders"])

    def test_a_float_amount_or_a_foreign_url_stores_no_share(self):
        payload = json.loads(_recorded("pirate-raydium.rugcheck.json"))
        payload["topHolders"][0]["amount"] = 1.5
        refused_shape = interpret_rugcheck(PIRATE, payload, source=rugcheck_url(PIRATE), read_ts_ms=WHEN)
        self.assertEqual(refused_shape["status"], "NOT_OBSERVED")
        self.assertEqual(refused_shape["reason"], "HOLDER_SHAPE")
        self.assertIsNone(refused_shape["top10_share_ppm"])
        self.assertIsNone(refused_shape["supply_atoms"])
        foreign = interpret_rugcheck(
            PIRATE, json.loads(_recorded("pirate-raydium.rugcheck.json")),
            source="https://evil.example/v1/tokens/" + PIRATE + "/report", read_ts_ms=WHEN,
        )
        self.assertEqual(foreign["status"], "NOT_OBSERVED")
        self.assertEqual(foreign["reason"], "REFUSED")
        self.assertIsNone(foreign["top1_share_ppm"])

    def test_the_public_client_refuses_a_host_outside_the_report_prefix(self):
        with patch("src.multi_brain_research.holder_capture.build_opener") as opener:
            with self.assertRaises(ValueError):
                _http_get("https://evil.example/v1/tokens/" + PIRATE + "/report")
            opener.assert_not_called()


class CaptureTests(unittest.TestCase):
    def _root(self, folder: str, mint: str, pair: str) -> Path:
        root = Path(folder)
        day = root / "snapshots" / "2026-11-05"
        day.mkdir(parents=True)
        row = {
            "source": "dexscreener_pairs",
            "chain": "solana",
            "token_address": mint,
            "symbol": "PIRATE",
            "pair_address": pair,
            "dex": "raydium",
            "price_usd": 0.0004277,
            "liquidity_usd": 132043.71,
            "volume_h1": 786335.39,
            "market_cap": 427720.0,
            "price_change_h1": 203.0,
            "buys_h1": 10,
            "sells_h1": 4,
            "ts": "2026-11-05T02:00:01+00:00",
            "fetched_at": "2026-11-05T02:00:01+00:00",
        }
        (day / "0200.jsonl").write_text(json.dumps(row) + "\n", encoding="utf-8")
        (root / "latest.json").write_text(json.dumps({
            "snapshot_file": "snapshots/2026-11-05/0200.jsonl",
            "sources": {},
        }), encoding="utf-8")
        return root

    def test_a_recorded_429_falls_back_to_the_recorded_report_and_stores_the_read(self):
        raw_429 = _recorded("solana-rpc-getTokenLargestAccounts-429.json")
        report = _recorded("pirate-raydium.rugcheck.json")
        headers = Message()
        headers["Retry-After"] = "10"
        calls = []
        sleeps = []

        def rpc_transport(method, params):
            calls.append(method)
            if method == "getTokenSupply":
                return {"jsonrpc": "2.0", "result": {"context": {"slot": 10}, "value": {
                    "amount": "999995177946633", "decimals": 6,
                }}, "id": 1}
            if method == "getTokenLargestAccounts":
                raise urllib.error.HTTPError(ENDPOINT, 429, "Too Many Requests", headers, io.BytesIO(raw_429))
            raise AssertionError(method)

        def http_transport(url):
            self.assertEqual(url, rugcheck_url(PIRATE))
            return 200, {}, report

        with tempfile.TemporaryDirectory() as folder:
            root = self._root(folder, PIRATE, PIRATE_PAIR)
            summary = capture_holders(
                root, interval_s=0, sleep=sleeps.append, now_ms=WHEN,
                rpc_transport=rpc_transport, http_transport=http_transport,
            )
            self.assertEqual(summary["succeeded"], 1)
            self.assertEqual(summary["not_observed"], 0)
            self.assertEqual(summary["source_used"], "https://api.rugcheck.xyz")
            self.assertEqual(summary["execution_allowed"], False)
            self.assertEqual(summary["live_orders"], False)
            self.assertTrue(all(item["status"] == "NOT_OBSERVED" for item in summary["rpc_probes"]))
            self.assertEqual(sleeps, [10, 10])
            self.assertEqual(calls.count("getTokenLargestAccounts"), 4)
            rows = load_holder_reads(root)[PIRATE]
            self.assertEqual(len(rows), 1)
            stored = rows[0]
            self.assertEqual(stored["status"], "AVAILABLE")
            self.assertEqual(stored["source"], rugcheck_url(PIRATE))
            self.assertIsInstance(stored["read_ts_ms"], int)
            self.assertGreaterEqual(stored["read_ts_ms"], WHEN)
            self.assertEqual(stored["rpc_probe"]["status"], "NOT_OBSERVED")
            self.assertEqual(stored["rpc_probe"]["reason"], "RATE_LIMITED")
            self.assertEqual(stored["rpc_probe"]["http_status"], 429)
            self.assertIsInstance(stored["top10_ex_vault_share_ppm"], int)
            self.assertEqual(stored["body_sha256"], hashlib.sha256(report).hexdigest())
            self.assertFalse(stored["execution_allowed"])
            self.assertFalse(stored["live_orders"])

    def test_a_failed_fallback_is_stored_as_not_observed_without_a_share(self):
        headers = Message()
        headers["Retry-After"] = "0"

        def rpc_transport(method, params):
            if method == "getTokenSupply":
                return {"jsonrpc": "2.0", "result": {"context": {"slot": 3}, "value": {"amount": "10", "decimals": 6}}, "id": 1}
            raise urllib.error.HTTPError(ENDPOINT, 429, "Too Many Requests", headers, io.BytesIO(_recorded("solana-rpc-getTokenLargestAccounts-429.json")))

        def http_transport(url):
            return 429, {"Retry-After": "0"}, b""

        with tempfile.TemporaryDirectory() as folder:
            root = self._root(folder, PIRATE, PIRATE_PAIR)
            summary = capture_holders(
                root, interval_s=0, sleep=lambda delay: None, now_ms=WHEN,
                rpc_transport=rpc_transport, http_transport=http_transport,
            )
            self.assertEqual(summary["succeeded"], 0)
            self.assertEqual(summary["not_observed"], 1)
            stored = load_holder_reads(root)[PIRATE][0]
            self.assertEqual(stored["status"], "NOT_OBSERVED")
            self.assertEqual(stored["reason"], "RATE_LIMITED")
            self.assertIsNone(stored["top1_share_ppm"])
            self.assertIsNone(stored["top10_share_ppm"])
            self.assertIsNone(stored["top10_ex_vault_share_ppm"])
            self.assertIsNone(stored["supply_atoms"])
            self.assertEqual(stored["source"], rugcheck_url(PIRATE))
            self.assertIsInstance(stored["read_ts_ms"], int)
            self.assertFalse(stored["execution_allowed"])
            self.assertFalse(stored["live_orders"])


class TimeGateTests(unittest.TestCase):
    def test_a_read_joins_only_a_decision_at_or_after_its_read_time(self):
        payload = json.loads(_recorded("zero-pumpfun.rugcheck.json"))
        early_ms = 1_793_841_601_000
        read_ms = early_ms + 60_000
        late_ms = read_ms + 60_000
        read = interpret_rugcheck(ZERO, payload, source=rugcheck_url(ZERO), read_ts_ms=read_ms, pair_address=ZERO_PAIR)
        self.assertEqual(join_holder_read([read], early_ms), None)
        self.assertEqual(join_holder_read([read], read_ms)["top10_ex_vault_share_ppm"], read["top10_ex_vault_share_ppm"])
        missed = dict(read)
        missed["status"] = "NOT_OBSERVED"
        missed["reason"] = "RATE_LIMITED"
        missed["read_ts_ms"] = read_ms + 1
        for key in ("top1_share_ppm", "top10_share_ppm", "top1_ex_vault_share_ppm", "top10_ex_vault_share_ppm", "supply_atoms"):
            missed[key] = None
        self.assertEqual(join_holder_read([read, missed], late_ms)["status"], "AVAILABLE")
        self.assertEqual(join_holder_read([missed], read_ms), None)

        seen = []

        def score(observation, now_ms):
            seen.append((now_ms, observation.get("holder_concentration")))
            return {
                "fused_score_ppm": 1,
                "confidence_ppm": 0,
                "brains": {},
                "provenance": {},
                "action": "NO_EXECUTION",
                "execution_allowed": False,
            }

        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            day = root / "snapshots" / "2026-11-05"
            day.mkdir(parents=True)
            def row(name, ts, price):
                return {
                    "source": "dexscreener_pairs", "chain": "solana", "token_address": ZERO,
                    "symbol": "ZERO", "pair_address": ZERO_PAIR, "dex": "pumpfun",
                    "price_usd": price, "liquidity_usd": 20000.0, "volume_h1": 1000.0,
                    "market_cap": 30000.0, "price_change_h1": 1.0, "buys_h1": 3, "sells_h1": 1,
                    "ts": ts, "fetched_at": ts,
                }
            (day / "0200.jsonl").write_text(json.dumps(row("0200", "2026-11-05T02:00:01+00:00", 1.0)) + "\n", encoding="utf-8")
            (day / "0210.jsonl").write_text(json.dumps(row("0210", "2026-11-05T02:10:01+00:00", 1.1)) + "\n", encoding="utf-8")
            (root / "latest.json").write_text(json.dumps({"snapshot_file": "snapshots/2026-11-05/0210.jsonl", "sources": {}}), encoding="utf-8")
            holder = root / "holder-reads"
            holder.mkdir()
            # The snapshot stamps below are fixed; the read sits between them.
            from src.multi_brain_research.snapshot_feed import parse_time_ms
            first = parse_time_ms("2026-11-05T02:00:01+00:00")
            second = parse_time_ms("2026-11-05T02:10:01+00:00")
            between = interpret_rugcheck(ZERO, payload, source=rugcheck_url(ZERO), read_ts_ms=first + 1, pair_address=ZERO_PAIR)
            self.assertLess(first, between["read_ts_ms"])
            self.assertLess(between["read_ts_ms"], second)
            (holder / "2026-11-05.jsonl").write_text(json.dumps(between) + "\n", encoding="utf-8")
            with_reads = replay(root, root / "paper.jsonl", root / "theses", score=score, limit=25, entry_floor=False)
            self.assertIsNone(seen[0][1])
            self.assertEqual(seen[1][1]["read_ts_ms"], between["read_ts_ms"])
            self.assertEqual(seen[1][1]["top10_ex_vault_share_ppm"], between["top10_ex_vault_share_ppm"])
            self.assertGreaterEqual(seen[1][0], between["read_ts_ms"])
            self.assertEqual(with_reads["holder_joined"], 1)
            self.assertEqual(with_reads["execution_allowed"], False)
            seen.clear()
            replay(root, root / "paper-off.jsonl", root / "theses-off", score=score, limit=25, entry_floor=False, use_holder_reads=False)
            self.assertIsNone(seen[0][1])
            self.assertIsNone(seen[1][1])

    def test_a_later_read_does_not_change_the_fused_score(self):
        payload = json.loads(_recorded("zero-pumpfun.rugcheck.json"))
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
        read = interpret_rugcheck(ZERO, payload, source=rugcheck_url(ZERO), read_ts_ms=WHEN, pair_address=ZERO_PAIR)
        early = dict(observation, holder_concentration=read)
        late = dict(observation, holder_concentration=dict(read, read_ts_ms=WHEN + 1))
        with_early = fuse(early, now_ms=WHEN)
        with_late = fuse(late, now_ms=WHEN)
        self.assertEqual(with_early["fused_score_ppm"], plain["fused_score_ppm"])
        self.assertEqual(with_late["fused_score_ppm"], plain["fused_score_ppm"])
        self.assertEqual(with_early["inputs"]["holder_concentration"]["status"], "AVAILABLE")
        self.assertEqual(with_early["inputs"]["holder_concentration"]["read_ts_ms"], WHEN)
        self.assertEqual(with_early["inputs"]["holder_concentration"]["role"], "INPUT_NOT_A_VOTE")
        self.assertEqual(with_late["inputs"]["holder_concentration"]["status"], "NOT_CAUSAL")
        self.assertIsNone(with_late["inputs"]["holder_concentration"]["top10_share_ppm"])
        self.assertNotIn("holder", with_early["brains"])


class PendingCaptureTests(unittest.TestCase):
    def _store(self, folder: str) -> Path:
        root = Path(folder)
        day = root / "snapshots" / "2026-11-05"
        day.mkdir(parents=True)
        fresh = {
            "source": "dexscreener_pairs", "chain": "solana", "token_address": PIRATE,
            "symbol": "PIRATE", "pair_address": PIRATE_PAIR, "price_usd": 1.0,
            "liquidity_usd": 20000.0, "volume_h1": 9000.0, "market_cap": 40000.0,
            "ts": "2026-11-05T03:00:01+00:00", "fetched_at": "2026-11-05T03:00:01+00:00",
        }
        new = {
            "source": "dexscreener_pairs", "chain": "solana", "token_address": ZERO,
            "symbol": "ZERO", "pair_address": ZERO_PAIR, "price_usd": 1.0,
            "liquidity_usd": 20000.0, "volume_h1": 100.0, "market_cap": 30000.0,
            "ts": "2026-11-05T03:00:01+00:00", "fetched_at": "2026-11-05T03:00:01+00:00",
        }
        (day / "0300.jsonl").write_text(
            "\n".join(json.dumps(row) for row in (fresh, new)) + "\n",
            encoding="utf-8",
        )
        (root / "latest.json").write_text(json.dumps({
            "snapshot_file": "snapshots/2026-11-05/0300.jsonl",
            "sources": {},
        }), encoding="utf-8")
        holder = root / "holder-reads"
        holder.mkdir()
        cached = {
            "mint": PIRATE,
            "status": "AVAILABLE",
            "source": rugcheck_url(PIRATE),
            "read_ts_ms": WHEN,
            "top10_share_ppm": 1000,
            "top10_ex_vault_share_ppm": 1000,
            "execution_allowed": False,
            "live_orders": False,
        }
        (holder / "2026-11-05.jsonl").write_text(json.dumps(cached) + "\n", encoding="utf-8")
        return root

    def test_pending_reads_a_new_mint_and_skips_a_fresh_cache(self):
        report = _recorded("zero-pumpfun.rugcheck.json")
        headers = Message()
        headers["Retry-After"] = "0"
        calls = []

        def rpc_transport(method, params):
            if method == "getTokenSupply":
                return {"jsonrpc": "2.0", "result": {"context": {"slot": 4}, "value": {"amount": "10", "decimals": 6}}, "id": 1}
            raise urllib.error.HTTPError(ENDPOINT, 429, "Too Many Requests", headers, io.BytesIO(_recorded("solana-rpc-getTokenLargestAccounts-429.json")))

        def http_transport(url):
            calls.append(url)
            self.assertEqual(url, rugcheck_url(ZERO))
            return 200, {}, report

        with tempfile.TemporaryDirectory() as folder:
            root = self._store(folder)
            summary = capture_holders(
                root, pending_only=True, interval_s=0, sleep=lambda _delay: None, now_ms=WHEN,
                rpc_transport=rpc_transport, http_transport=http_transport, limit=8,
            )
            self.assertEqual(summary["stored"], 1)
            self.assertEqual(summary["succeeded"], 1)
            self.assertEqual(summary["cached"], 1)
            self.assertEqual(summary["reasons"]["NEW_MINT"], 1)
            self.assertEqual(summary["execution_allowed"], False)
            self.assertEqual(summary["live_orders"], False)
            self.assertEqual(calls, [rugcheck_url(ZERO)])
            stored = load_holder_reads(root)[ZERO][-1]
            self.assertEqual(stored["status"], "AVAILABLE")
            self.assertEqual(stored["source"], rugcheck_url(ZERO))
            self.assertIsInstance(stored["read_ts_ms"], int)
            self.assertGreaterEqual(stored["read_ts_ms"], WHEN)
            self.assertEqual(stored["snapshot_file"], "snapshots/2026-11-05/0300.jsonl")
            self.assertFalse(stored["execution_allowed"])
            self.assertFalse(stored["live_orders"])
            calls.clear()
            again = capture_holders(
                root, pending_only=True, interval_s=0, sleep=lambda _delay: None, now_ms=WHEN,
                rpc_transport=rpc_transport, http_transport=http_transport, limit=8,
            )
            self.assertEqual(again["stored"], 0)
            self.assertEqual(again["mints"], 0)
            self.assertEqual(calls, [])
            self.assertGreaterEqual(again["cached"], 2)

    def test_a_recent_not_observed_waits_and_an_old_one_is_retried(self):
        from src.multi_brain_research.holder_capture import read_is_due
        missed = [{
            "mint": ZERO, "status": "NOT_OBSERVED", "reason": "RATE_LIMITED",
            "source": rugcheck_url(ZERO), "read_ts_ms": WHEN, "top10_share_ppm": None,
        }]
        self.assertIsNone(read_is_due(missed, WHEN + 1_000, fresh_ms=6 * 60 * 60 * 1000, retry_ms=30 * 60 * 1000))
        self.assertEqual(
            read_is_due(missed, WHEN + 30 * 60 * 1000, fresh_ms=6 * 60 * 60 * 1000, retry_ms=30 * 60 * 1000),
            "RETRY_NOT_OBSERVED",
        )
        available = [{"status": "AVAILABLE", "read_ts_ms": WHEN}]
        self.assertIsNone(read_is_due(available, WHEN + 60_000, fresh_ms=6 * 60 * 60 * 1000, retry_ms=30 * 60 * 1000))
        self.assertEqual(
            read_is_due(available, WHEN + 6 * 60 * 60 * 1000, fresh_ms=6 * 60 * 60 * 1000, retry_ms=30 * 60 * 1000),
            "STALE_AVAILABLE",
        )
        self.assertEqual(read_is_due([], WHEN, fresh_ms=1, retry_ms=1), "NEW_MINT")

    def test_a_pump_bonding_curve_mint_is_pending_when_it_has_no_pair_row(self):
        from src.multi_brain_research.holder_capture import mints_from_records, pending_mints
        curve = {
            "source": "pumpfun_bonding_curve", "chain": "solana",
            "token_address": "BJeVzBKCJ7cqT6Jo9CaB6DmBRabVR32kpFYjey3opump",
            "symbol": "cozy", "pair_address": "3Tn1gEEDjJn9ed43aVL7mZELbHBKnRYJmq46iGtyjNoz",
            "dex": "pump-fun", "graduation": "BONDING_CURVE", "volume_h1": 50.0,
            "price_usd": 4.617123059573464e-09,
            "ts": "2026-11-05T03:00:01+00:00", "fetched_at": "2026-11-05T03:00:01+00:00",
        }
        with tempfile.TemporaryDirectory() as folder:
            root = self._store(folder)
            path = root / "snapshots" / "2026-11-05" / "0300.jsonl"
            path.write_text(path.read_text(encoding="utf-8") + json.dumps(curve) + "\n", encoding="utf-8")
            records = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
            mints = {item["mint"] for item in mints_from_records(records)}
            self.assertIn("BJeVzBKCJ7cqT6Jo9CaB6DmBRabVR32kpFYjey3opump", mints)
            selected, stats = pending_mints(root, now_ms=WHEN, limit=1)
            self.assertEqual(len(selected), 1)
            self.assertEqual(selected[0]["due"], "NEW_MINT")
            self.assertEqual(selected[0]["mint"], ZERO)
            self.assertEqual(stats["cached"], 1)
            self.assertGreaterEqual(stats["due"], 2)


if __name__ == "__main__":
    unittest.main()
