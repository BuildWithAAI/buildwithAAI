"""Pump.fun public replacement.

The fixture under tests/fixtures/giant-brain-pools/ is a trimmed GeckoTerminal
new-pools response recorded on 2026-11-05. This file does not open a socket.
"""
from __future__ import annotations

import json
import unittest
import urllib.error
from pathlib import Path

from src.multi_brain_research.pump_public import (
    FRONTEND_URL,
    SOURCE_BONDING,
    SOURCE_GRADUATION,
    apply_pump_sources,
    disabled_frontend_status,
    frontend_block_reason,
    new_pools_url,
    parse_new_pools,
    read_json,
    retry_delay_seconds,
)

FIXTURE = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "giant-brain-pools" / "new_pools_2026-11-05.json"
FETCHED = "2026-11-05T04:05:01+00:00"


class RecordedPoolsTests(unittest.TestCase):
    def setUp(self):
        self.payload = json.loads(FIXTURE.read_text(encoding="utf-8"))

    def test_a_recorded_page_keeps_bonding_curve_and_graduation_rows(self):
        rows = parse_new_pools(self.payload, FETCHED)
        by_source = {row["source"]: row for row in rows}
        self.assertEqual(set(by_source), {SOURCE_BONDING, SOURCE_GRADUATION})
        bonding = by_source[SOURCE_BONDING]
        graduation = by_source[SOURCE_GRADUATION]
        self.assertEqual(bonding["graduation"], "BONDING_CURVE")
        self.assertEqual(bonding["dex"], "pump-fun")
        self.assertEqual(bonding["symbol"], "cozy")
        self.assertEqual(bonding["name"], "Jesus will save")
        self.assertEqual(bonding["token_address"], "BJeVzBKCJ7cqT6Jo9CaB6DmBRabVR32kpFYjey3opump")
        self.assertEqual(bonding["pair_address"], "3Tn1gEEDjJn9ed43aVL7mZELbHBKnRYJmq46iGtyjNoz")
        self.assertEqual(bonding["pool_created_at"], "2026-11-05T04:04:33Z")
        raw_bonding = next(pool for pool in self.payload["data"] if pool["attributes"]["address"] == bonding["pair_address"])
        self.assertEqual(bonding["price_usd"], float(raw_bonding["attributes"]["base_token_price_usd"]))
        self.assertEqual(bonding["liquidity_usd"], float(raw_bonding["attributes"]["reserve_in_usd"]))
        self.assertEqual(bonding["volume_h1"], float(raw_bonding["attributes"]["volume_usd"]["h1"]))
        self.assertIsNone(bonding["market_cap"])
        self.assertEqual(bonding["buys_h1"], raw_bonding["attributes"]["transactions"]["h1"]["buys"])
        self.assertEqual(bonding["sells_h1"], raw_bonding["attributes"]["transactions"]["h1"]["sells"])
        self.assertEqual(graduation["graduation"], "PUMPSWAP")
        self.assertEqual(graduation["dex"], "pumpswap")
        self.assertEqual(graduation["symbol"], "Rockstar")
        self.assertEqual(graduation["token_address"], "JSJrPes1WzENnPxZm7SnoLuFVgPwisZpkm35f9Xpump")
        self.assertEqual(graduation["pool_created_at"], "2026-11-05T04:04:48Z")
        self.assertEqual(graduation["fetched_at"], FETCHED)
        self.assertEqual(graduation["chain"], "solana")
        symbols = {row["symbol"] for row in rows}
        self.assertNotIn("TRUMPDULLA", symbols)

    def test_apply_uses_the_saved_page_and_page_two_and_skips_the_frontend(self):
        calls = []

        def get(url):
            calls.append(url)
            return {"data": [], "included": []}

        result = apply_pump_sources(self.payload, get, sleep=lambda _delay: None, fetched_at=FETCHED)
        self.assertEqual(calls, [new_pools_url(2)])
        self.assertNotIn(FRONTEND_URL, calls)
        self.assertEqual(result["status"]["pumpfun_currently_live"]["disabled"], True)
        self.assertEqual(result["status"]["pumpfun_currently_live"]["reason"], "CLOUDFLARE_CHALLENGE")
        self.assertEqual(result["status"]["pumpfun_currently_live"]["ok"], False)
        self.assertEqual(result["status"]["pumpfun_currently_live"]["records"], 0)
        self.assertEqual(result["status"][SOURCE_BONDING]["records"], 1)
        self.assertEqual(result["status"][SOURCE_GRADUATION]["records"], 1)
        self.assertTrue(result["status"][SOURCE_BONDING]["ok"])
        self.assertEqual(result["errors"], [])
        self.assertEqual(len(result["rows"]), 2)

    def test_a_failed_page_two_keeps_rows_from_the_saved_page(self):
        def get(url):
            raise urllib.error.HTTPError(url, 429, "Too Many Requests", None, None)

        result = apply_pump_sources(self.payload, get, sleep=lambda _delay: None, fetched_at=FETCHED)
        self.assertEqual(len(result["rows"]), 2)
        self.assertTrue(result["status"][SOURCE_BONDING]["ok"])
        self.assertIn("429", result["status"][SOURCE_BONDING]["error"])
        self.assertEqual(result["status"]["pumpfun_currently_live"]["replacement"], [SOURCE_BONDING, SOURCE_GRADUATION])


class RetryTests(unittest.TestCase):
    def test_429_waits_once_and_then_parses(self):
        calls = []
        sleeps = []

        def fetch(url):
            calls.append(url)
            if len(calls) == 1:
                return 429, {"Retry-After": "3"}, b""
            return 200, {}, b'{"data":[]}'

        body = read_json(new_pools_url(2), fetch, sleeps.append)
        self.assertEqual(body, {"data": []})
        self.assertEqual(sleeps, [3])
        self.assertEqual(len(calls), 2)

    def test_a_second_429_uses_the_capped_delay_and_raises(self):
        sleeps = []

        def fetch(url):
            return 429, {"Retry-After": "99"}, b""

        with self.assertRaises(urllib.error.HTTPError) as caught:
            read_json(new_pools_url(2), fetch, sleeps.append, attempts=2)
        self.assertEqual(caught.exception.code, 429)
        self.assertEqual(sleeps, [8])
        self.assertEqual(retry_delay_seconds({"Retry-After": "0"}), 0)
        self.assertEqual(retry_delay_seconds({}), 2)

    def test_a_cloudflare_403_is_named(self):
        body = b"<!DOCTYPE html><html><head><title>Just a moment...</title><script>cloudflare</script>"
        self.assertEqual(frontend_block_reason(403, body), "CLOUDFLARE_CHALLENGE")
        self.assertIsNone(frontend_block_reason(200, body))
        status = disabled_frontend_status()
        self.assertEqual(status["reason"], "CLOUDFLARE_CHALLENGE")
        self.assertTrue(status["disabled"])
        self.assertFalse(status["ok"])
        self.assertEqual(status["records"], 0)


if __name__ == "__main__":
    unittest.main()
