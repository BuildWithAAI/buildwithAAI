"""HTTP JSON sources (pump.fun frontend API, DexScreener, GeckoTerminal), each with its own
rate limiter, circuit breaker, retry/backoff and deterministic cache."""
from __future__ import annotations
import time
import requests
from ..cache import DiskCache, make_key
from ..resilience import TokenBucket, CircuitBreaker, backoff_delays
from .. import logging_setup as L

log = L.get("http")


class HttpError(Exception):
    pass


class HttpSource:
    def __init__(self, name, base, rps, cache: DiskCache, headers=None, max_attempts=4, timeout=30):
        self.name, self.base, self.cache = name, base.rstrip("/"), cache
        self.bucket = TokenBucket(rps, burst=2)
        self.breaker = CircuitBreaker(name, failure_threshold=5, reset_timeout_s=60)
        self.s = requests.Session()
        self.s.headers.update(headers or {})
        self.max_attempts, self.timeout = max_attempts, timeout
        self.stats = {"calls": 0, "cache_hits": 0, "rate_limited": 0, "errors": 0, "not_found": 0}

    def get(self, path, ttl=120):
        url = f"{self.base}{path}"
        k = make_key("http", url)
        hit = self.cache.get(k, ttl)
        if hit is not None:
            self.stats["cache_hits"] += 1
            return hit
        if not self.breaker.allow():
            raise HttpError(f"{self.name}: circuit open")
        last = None
        delays = backoff_delays(self.max_attempts, base=1.0)
        for _ in range(self.max_attempts):
            self.bucket.acquire(); self.stats["calls"] += 1
            try:
                r = self.s.get(url, timeout=self.timeout)
                if r.status_code == 429:
                    self.stats["rate_limited"] += 1
                    self.bucket.penalize(float(r.headers.get("Retry-After") or 10)); last = "429"; continue
                if r.status_code == 404:
                    self.stats["not_found"] += 1; self.breaker.success()
                    self.cache.set(k, {"__not_found__": True}, 600 if ttl else 0)
                    return None
                if r.status_code >= 500 or r.status_code in (403, 520, 521, 522):
                    raise requests.HTTPError(f"HTTP {r.status_code}")
                r.raise_for_status()
                j = r.json()
                self.breaker.success()
                self.cache.set(k, j, ttl)
                return j
            except (requests.RequestException, ValueError) as e:
                self.stats["errors"] += 1; self.breaker.failure(); last = str(e)[:200]
                time.sleep(next(delays, 2))
        raise HttpError(f"{self.name} GET {path} failed: {last}")

    def get_json(self, path, ttl=120):
        j = self.get(path, ttl)
        return None if isinstance(j, dict) and j.get("__not_found__") else j

    def snapshot(self):
        return {**self.stats, "breaker": self.breaker.snapshot()}


class PumpFunApi:
    """Unofficial pump.fun frontend API (needs browser UA + Origin; verified 2026-10-31)."""
    def __init__(self, settings, cache):
        self.h = HttpSource("pumpfun", settings.pumpfun_api, settings.pumpfun_rps, cache,
                            {"User-Agent": settings.http_ua, "Accept": "application/json", "Origin": "https://pump.fun", "Referer": "https://pump.fun/"})

    def coin(self, mint, ttl=60):
        return self.h.get_json(f"/coins-v2/{mint}", ttl)

    def latest_coins(self, limit=50, offset=0, ttl=10):
        return self.h.get_json(f"/coins?offset={offset}&limit={limit}&sort=created_timestamp&order=DESC&includeNsfw=true", ttl) or []

    def created_by(self, wallet, limit=50, offset=0, ttl=900):
        return self.h.get_json(f"/coins-v2/user-created-coins/{wallet}?offset={offset}&limit={limit}&includeNsfw=true", ttl)


class DexScreenerApi:
    def __init__(self, settings, cache):
        self.h = HttpSource("dexscreener", settings.dexscreener_api, settings.dexscreener_rps, cache, {"User-Agent": settings.http_ua})

    def token_pairs(self, mint, ttl=60):
        return (self.h.get_json(f"/latest/dex/tokens/{mint}", ttl) or {}).get("pairs") or []


class GeckoTerminalApi:
    def __init__(self, settings, cache):
        self.h = HttpSource("geckoterminal", settings.geckoterminal_api, settings.geckoterminal_rps, cache,
                            {"User-Agent": settings.http_ua, "Accept": "application/json"})

    def token_pools(self, mint, ttl=3600):
        return (self.h.get_json(f"/networks/solana/tokens/{mint}/pools", ttl) or {}).get("data") or []

    def ohlcv(self, pool, timeframe="minute", aggregate=15, before_ts=None, limit=200, currency="usd", ttl=None):
        q = f"/networks/solana/pools/{pool}/ohlcv/{timeframe}?aggregate={aggregate}&limit={limit}&currency={currency}"
        if before_ts: q += f"&before_timestamp={int(before_ts)}"
        return ((self.h.get_json(q, ttl) or {}).get("data") or {}).get("attributes", {}).get("ohlcv_list") or []
