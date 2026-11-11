"""Jupiter token search and the causal readout suffix.

tests/fixtures/giant-brain-jupiter/ is one public search response recorded on
2026-11-05. This file does not open a socket.
"""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from src.multi_brain_research.flyvis_market import decisions_from_series
from src.multi_brain_research.jupiter_capture import (
    FEATURE_NAMES,
    append_read,
    capture_jupiter_tokens,
    coverage_report,
    join_jupiter_read,
    jupiter_veto_reasons,
    load_jupiter_reads,
    readout_features,
)
from src.multi_brain_research.jupiter_tokens import (
    TOP_HOLDERS_PERCENT,
    fetch_search,
    parse_search,
    raw_fields,
    search_url,
    search_url_ok,
)
from src.multi_brain_research.snapshot_feed import SnapshotError, parse_time_ms
from src.multi_brain_research.watch import replay

FIXTURE = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "giant-brain-jupiter" / "pillheads-search-2026-11-05.json"
MINT = "BFJd5mWCvu7yMivKCM7Xh8Dx17GgBbwaxcmFX3Aqpump"
OTHER = "So11111111111111111111111111111111111111112"
WHEN = 1_793_860_000_000


def _recorded():
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def _headers():
    return {"Retry-After": "1"}


class RecordedSearchTests(unittest.TestCase):
    def test_a_recorded_search_keeps_the_fields_the_body_has(self):
        payload = _recorded()
        self.assertEqual(len(payload), 1)
        raw = raw_fields(payload[0])
        self.assertEqual(raw["id"], MINT)
        self.assertEqual(raw["symbol"], "PILLHEADS")
        self.assertEqual(raw["organicScore"], 0)
        self.assertEqual(raw["organicScoreLabel"], "low")
        self.assertEqual(raw["holderCount"], 811)
        self.assertTrue(raw["audit"]["mintAuthorityDisabled"])
        self.assertTrue(raw["audit"]["freezeAuthorityDisabled"])
        self.assertEqual(raw["audit"]["topHoldersPercentage"], 4.695779624880472)
        self.assertEqual(raw["stats5m"]["numBuys"], 736)
        self.assertEqual(raw["stats5m"]["numSells"], 195)
        self.assertEqual(raw["stats5m"]["numTraders"], 442)
        self.assertEqual(raw["stats5m"]["buyVolume"], 11100.181524645024)
        self.assertEqual(raw["stats5m"]["sellVolume"], 12575.034303509256)
        self.assertIsNone(raw["stats5m"]["numOrganicBuyers"])
        self.assertNotIn("dev", raw)
        self.assertNotIn("icon", raw)
        parsed = parse_search(payload, [MINT, OTHER])
        self.assertEqual(parsed[MINT]["id"], MINT)
        self.assertIsNone(parsed[OTHER])

    def test_the_search_url_is_allowlisted_and_a_key_is_refused(self):
        url = search_url([MINT])
        self.assertEqual(url, f"https://lite-api.jup.ag/tokens/v2/search?query={MINT}")
        self.assertTrue(search_url_ok(url, [MINT]))
        self.assertTrue(search_url_ok(search_url([MINT, OTHER]), [MINT, OTHER]))
        self.assertFalse(search_url_ok(url + "&x-api-key=secret"))
        self.assertFalse(search_url_ok(url.replace("https://lite-api.jup.ag", "https://api.jup.ag")))
        self.assertFalse(search_url_ok(url.replace("https://", "http://")))
        self.assertFalse(search_url_ok("https://lite-api.jup.ag/tokens/v2/tag?query=verified"))
        with self.assertRaises(SnapshotError):
            search_url(["not a mint"])
        with self.assertRaises(SnapshotError):
            search_url([])

    def test_a_429_is_retried_once_and_a_missing_mint_is_not_observed(self):
        body = FIXTURE.read_bytes()
        calls = {"n": 0}

        def transport(url):
            calls["n"] += 1
            if calls["n"] == 1:
                return 429, _headers(), b'{"error":"rate"}'
            self.assertTrue(search_url_ok(url, [MINT, OTHER]))
            return 200, {}, body

        found = fetch_search([MINT, OTHER], transport=transport, sleep=lambda _seconds: None)
        self.assertEqual(calls["n"], 2)
        self.assertEqual(found[MINT]["status"], "AVAILABLE")
        self.assertEqual(found[MINT]["retries"], 1)
        self.assertEqual(found[MINT]["features"]["holder_count"], 811)
        self.assertEqual(found[MINT]["features"]["rule_top_holders_percentage"], TOP_HOLDERS_PERCENT)
        self.assertIsNone(found[MINT]["features"]["num_organic_buyers_5m"])
        self.assertEqual(found[OTHER]["status"], "NOT_OBSERVED")
        self.assertEqual(found[OTHER]["reason"], "NOT_IN_RESPONSE")
        self.assertFalse(found[MINT]["execution_allowed"])
        self.assertFalse(found[MINT]["live_orders"])

    def test_a_second_429_stays_not_observed(self):
        def transport(_url):
            return 429, _headers(), b"{}"

        found = fetch_search([MINT], transport=transport, sleep=lambda _seconds: None)
        self.assertEqual(found[MINT]["status"], "NOT_OBSERVED")
        self.assertEqual(found[MINT]["reason"], "RATE_LIMITED")
        self.assertEqual(found[MINT]["http_status"], 429)
        self.assertEqual(found[MINT]["retry_after_seconds"], 1)
        self.assertEqual(found[MINT]["retries"], 1)


class CausalReadTests(unittest.TestCase):
    def _available(self, read_ts_ms, **features):
        base = {
            "organic_score": 0,
            "organic_score_label": "low",
            "holder_count": 811,
            "mint_authority_disabled": True,
            "freeze_authority_disabled": True,
            "top_holders_percentage": 4.695779624880472,
            "buy_volume_5m": 11100.181524645024,
            "sell_volume_5m": 12575.034303509256,
            "num_traders_5m": 442,
            "buy_volume_1h": 1.0,
            "sell_volume_1h": 1.0,
            "num_traders_1h": 10,
            "rule_top_holders_percentage": TOP_HOLDERS_PERCENT,
        }
        base.update(features)
        return {
            "protocol": "AAI_JUPITER_TOKENS_V1",
            "status": "AVAILABLE",
            "reason": None,
            "mint": MINT,
            "source": search_url([MINT]),
            "read_ts_ms": read_ts_ms,
            "features": base,
            "execution_allowed": False,
            "live_orders": False,
            "action": "NO_EXECUTION",
        }

    def test_a_later_read_is_not_joined_and_does_not_fill_the_suffix(self):
        early = self._available(WHEN - 1000)
        late = self._available(WHEN + 1000, freeze_authority_disabled=False, top_holders_percentage=80)
        self.assertEqual(join_jupiter_read([late, early], WHEN)["read_ts_ms"], WHEN - 1000)
        self.assertIsNone(join_jupiter_read([late], WHEN))
        self.assertEqual(readout_features(late, WHEN), [0.0] * len(FEATURE_NAMES))
        self.assertEqual(readout_features(None, WHEN), [0.0] * len(FEATURE_NAMES))
        missed = dict(early, status="NOT_OBSERVED", features=None, reason="RATE_LIMITED")
        self.assertEqual(readout_features(missed, WHEN), [0.0] * len(FEATURE_NAMES))
        present = readout_features(early, WHEN)
        self.assertEqual(len(present), len(FEATURE_NAMES))
        self.assertEqual(present[0], 1.0)
        self.assertEqual(present[1], -1.0)
        self.assertEqual(present[4], 1.0)
        self.assertEqual(present[5], 1.0)
        self.assertLess(present[6], 0.0)
        self.assertEqual(jupiter_veto_reasons(early, WHEN)[0], [])
        self.assertEqual(jupiter_veto_reasons(late, WHEN)[0], [])
        reasons, evidence = jupiter_veto_reasons(self._available(WHEN, freeze_authority_disabled=False, mint_authority_disabled=False, top_holders_percentage=50), WHEN)
        self.assertEqual(reasons, ["JUPITER_FREEZE_AUTHORITY", "JUPITER_MINT_AUTHORITY", "JUPITER_TOP_HOLDERS"])
        self.assertEqual(evidence["rule_top_holders_percentage"], 50)
        self.assertEqual(jupiter_veto_reasons(self._available(WHEN, top_holders_percentage=49.9), WHEN)[0], [])
        self.assertEqual(jupiter_veto_reasons(missed, WHEN)[0], [])

    def test_capture_appends_a_line_and_a_fresh_read_is_kept(self):
        body = FIXTURE.read_bytes()

        def transport(url):
            self.assertTrue(url.startswith("https://lite-api.jup.ag/tokens/v2/search?query="))
            return 200, {}, body

        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            day = root / "snapshots" / "2026-11-05"
            day.mkdir(parents=True)
            record = {
                "source": "dexscreener_pairs",
                "chain": "solana",
                "token_address": MINT,
                "symbol": "PILLHEADS",
                "pair_address": "H3N46U1JgdKRiJHU2a8jnYEa9ih8Zc3hTe6BXG7zfE78",
                "dex": "pumpswap",
                "price_usd": 0.00014,
                "volume_h1": 10,
                "ts": "2026-11-05T14:10:02+00:00",
                "fetched_at": "2026-11-05T14:10:02+00:00",
            }
            (day / "1410.jsonl").write_text(json.dumps(record) + "\n", encoding="utf-8")
            (root / "latest.json").write_text(json.dumps({"snapshot_file": "snapshots/2026-11-05/1410.jsonl"}), encoding="utf-8")
            summary = capture_jupiter_tokens(root, limit=2, interval_s=0, now_ms=WHEN, transport=transport, pending_only=True)
            self.assertEqual(summary["succeeded"], 1)
            self.assertEqual(summary["not_observed"], 0)
            self.assertFalse(summary["execution_allowed"])
            self.assertFalse(summary["live_orders"])
            rows = load_jupiter_reads(root)[MINT]
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]["status"], "AVAILABLE")
            self.assertEqual(rows[0]["read_ts_ms"], WHEN + 1)
            self.assertEqual(rows[0]["source"], search_url([MINT]))
            self.assertNotIn("dev", rows[0]["raw"])
            again = capture_jupiter_tokens(root, limit=2, interval_s=0, now_ms=WHEN + 5, transport=transport, pending_only=True)
            self.assertEqual(again["stored"], 0)
            self.assertEqual(again["cached"], 1)
            self.assertEqual(len(load_jupiter_reads(root)[MINT]), 1)

    def test_the_veto_skips_a_paper_open_only_when_asked(self):
        record = {
            "source": "dexscreener_pairs",
            "chain": "solana",
            "token_address": MINT,
            "symbol": "PILLHEADS",
            "pair_address": "H3N46U1JgdKRiJHU2a8jnYEa9ih8Zc3hTe6BXG7zfE78",
            "dex": "pumpswap",
            "price_usd": 0.00014,
            "liquidity_usd": 20000.0,
            "market_cap": 100000.0,
            "volume_h1": 1000.0,
            "price_change_h1": 1.0,
            "buys_h1": 10,
            "sells_h1": 4,
            "ts": "2026-11-04T05:15:03+00:00",
            "fetched_at": "2026-11-04T05:15:03+00:00",
        }

        def signal(_observation, _now):
            return {
                "fused_score_ppm": 700_000,
                "confidence_ppm": 1,
                "mint": MINT,
                "brains": {"flyvis": {"paper_long_support_ppm": 700_000, "detail": "FLASH_KERNEL_READOUT", "council_member": True, "primary": True}},
                "provenance": {"observation_sha256": "ab" * 32},
                "action": "NO_EXECUTION",
                "execution_allowed": False,
            }

        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            day = root / "snapshots" / "2026-11-04"
            day.mkdir(parents=True)
            (day / "0515.jsonl").write_text(json.dumps(record) + "\n", encoding="utf-8")
            (root / "latest.json").write_text(json.dumps({"snapshot_file": "snapshots/2026-11-04/0515.jsonl"}), encoding="utf-8")
            decision = parse_time_ms(record["ts"])
            append_read(root, self._available(decision - 1000, freeze_authority_disabled=False))
            off = replay(root, root / "off.jsonl", root / "theses-off", score=signal, limit=25, use_holder_reads=False)
            on = replay(
                root, root / "on.jsonl", root / "theses-on", score=signal, limit=25,
                use_holder_reads=False, use_jupiter_veto=True,
            )
            self.assertEqual(off["opened"], 1)
            self.assertEqual(off["jupiter_veto"], False)
            self.assertEqual(off["jupiter_available"], 1)
            self.assertEqual(on["opened"], 0)
            self.assertEqual(on["entry_skipped"], 1)
            self.assertEqual(on["skip_reasons"], {"JUPITER_FREEZE_AUTHORITY": 1})
            self.assertFalse(on["execution_allowed"])
            self.assertFalse(on["live_orders"])

    def test_a_read_after_the_decision_does_not_change_kernel_activity(self):
        series = {
            MINT: [
                {"ts": "2026-11-05T14:00:00+00:00", "ts_ms": WHEN, "price_usd": 1.0, "buys_h1": 2, "sells_h1": 1, "liquidity_usd": 10.0},
                {"ts": "2026-11-05T14:05:00+00:00", "ts_ms": WHEN + 300_000, "price_usd": 1.1, "buys_h1": 3, "sells_h1": 1, "liquidity_usd": 11.0},
                {"ts": "2026-11-05T14:10:00+00:00", "ts_ms": WHEN + 600_000, "price_usd": 1.2, "buys_h1": 4, "sells_h1": 1, "liquidity_usd": 12.0},
            ]
        }
        plain = decisions_from_series(series)
        late = decisions_from_series(series, {MINT: [self._available(WHEN + 900_000)]})
        early = decisions_from_series(series, {MINT: [self._available(WHEN)]})
        self.assertEqual(len(plain), 1)
        self.assertEqual(len(late[0]["activity"]), len(plain[0]["activity"]) + len(FEATURE_NAMES))
        self.assertEqual(late[0]["activity"][:len(plain[0]["activity"])], plain[0]["activity"])
        self.assertEqual(late[0]["activity"][-len(FEATURE_NAMES):], [0.0] * len(FEATURE_NAMES))
        self.assertEqual(early[0]["activity"][-len(FEATURE_NAMES)], 1.0)
        self.assertEqual(early[0]["activity"][0:len(plain[0]["activity"])], plain[0]["activity"])

    def test_a_short_store_is_not_an_evaluation(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            day = root / "snapshots" / "2026-11-05"
            day.mkdir(parents=True)
            for name, price in (("1400.jsonl", 1.0), ("1405.jsonl", 1.1)):
                row = {
                    "source": "dexscreener_pairs", "chain": "solana", "token_address": MINT,
                    "symbol": "PILLHEADS", "pair_address": "H3N46U1JgdKRiJHU2a8jnYEa9ih8Zc3hTe6BXG7zfE78",
                    "price_usd": price, "ts": "2026-11-05T14:00:00+00:00", "fetched_at": "2026-11-05T14:00:00+00:00",
                }
                (day / name).write_text(json.dumps(row) + "\n", encoding="utf-8")
            (root / "latest.json").write_text("{}", encoding="utf-8")
            append_read(root, self._available(WHEN))
            report = coverage_report(root)
            self.assertFalse(report["evaluable"])
            self.assertEqual(report["reason"], "STORE_SHORTER_THAN_EIGHT_HOURS")
            self.assertFalse(report["readout_feature_default"])
            self.assertFalse(report["entry_veto_default"])
            self.assertFalse(report["execution_allowed"])
            self.assertFalse(report["live_orders"])


if __name__ == "__main__":
    unittest.main()
