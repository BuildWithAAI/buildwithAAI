"""Generic read-only HTTP source: per-source token bucket, circuit breaker, retry with full-jitter
backoff, deterministic cache (key = source name + URL + sorted params).

Only GET is implemented on purpose: aai-core never places orders or calls private endpoints.
"""
from __future__ import annotations
import time
import requests
from .cache import DiskCache, make_key
from .resilience import TokenBucket, CircuitBreaker, backoff_delays
from . import logging as L

log = L.get("http")
UA = "Mozilla/5.0 (X11; Linux x86_64) aai-core/0.1 (read-only market data)"


class SourceError(Exception):
    """Request failed after retries (network, 5xx, bad payload)."""


class SourceBlocked(SourceError):
    """403/451: geo-block or access denied. Not retried: retrying will not help."""


class SourceNotFound(SourceError):
    pass


class CircuitOpenError(SourceError):
    pass


class HttpSource:
    def __init__(self, name: str, base: str, rps: float, cache: DiskCache, headers: dict | None = None,
                 burst: int = 2, max_attempts: int = 3, timeout: float = 15, session=None, sleep=time.sleep):
        self.name, self.base, self.cache = name, base.rstrip("/"), cache
        self.bucket = TokenBucket(rps, burst=burst)
        self.breaker = CircuitBreaker(name, failure_threshold=5, reset_timeout_s=60)
        self.s = session or requests.Session()
        self.s.headers.update({"User-Agent": UA, "Accept": "application/json, text/csv;q=0.9"})
        self.s.headers.update(headers or {})
        self.max_attempts, self.timeout, self._sleep = max_attempts, timeout, sleep
        self.stats = {"calls": 0, "cache_hits": 0, "rate_limited": 0, "errors": 0, "blocked": 0, "not_found": 0,
                      "latency_ms_sum": 0.0}

    def key(self, path: str, params: dict | None) -> str:
        return make_key("http", self.name, f"{self.base}{path}", sorted((params or {}).items()))

    def get(self, path: str, params: dict | None = None, ttl: float | None = 60, parse: str = "json"):
        """GET base+path. ttl=None caches forever (closed candles), 0 never, >0 seconds."""
        k = self.key(path, params)
        hit = self.cache.get(k, ttl)
        if hit is not None:
            self.stats["cache_hits"] += 1
            if isinstance(hit, dict) and "__error__" in hit:   # recorded failure (replay fixtures)
                cls = {"blocked": SourceBlocked, "not_found": SourceNotFound}.get(hit["__error__"], SourceError)
                raise cls(f"{self.name}: {hit.get('detail')} (recorded)")
            return hit
        if not self.breaker.allow():
            raise CircuitOpenError(f"{self.name}: circuit open")
        url, last = f"{self.base}{path}", None
        delays = backoff_delays(self.max_attempts, base=0.5, cap=8)
        for attempt in range(self.max_attempts):
            self.bucket.acquire(); self.stats["calls"] += 1
            t0 = time.monotonic()
            try:
                r = self.s.get(url, params=params, timeout=self.timeout)
                self.stats["latency_ms_sum"] += (time.monotonic() - t0) * 1000
                if r.status_code == 429:
                    self.stats["rate_limited"] += 1
                    self.bucket.penalize(float(r.headers.get("Retry-After") or 5)); last = "HTTP 429"; continue
                if r.status_code in (403, 451):
                    self.stats["blocked"] += 1; self.breaker.failure()
                    detail = f"HTTP {r.status_code}: {r.text[:120].strip()}"
                    self._record_error(k, "blocked", detail)
                    raise SourceBlocked(f"{self.name}: {detail}")
                if r.status_code == 404:
                    self.stats["not_found"] += 1; self.breaker.success()
                    self._record_error(k, "not_found", "HTTP 404")
                    raise SourceNotFound(f"{self.name}: 404 {path}")
                if r.status_code >= 500:
                    raise requests.HTTPError(f"HTTP {r.status_code}")
                r.raise_for_status()
                body = r.json() if parse == "json" else r.text
                self.breaker.success()
                self.cache.set(k, body, ttl)
                return body
            except (SourceBlocked, SourceNotFound):
                raise
            except (requests.RequestException, ValueError) as e:
                self.stats["errors"] += 1; self.breaker.failure(); last = str(e)[:200]
                L.event(log, "http_retry", level=30, source=self.name, path=path, attempt=attempt, error=last)
                if attempt < self.max_attempts - 1:
                    self._sleep(next(delays, 2))
        self._record_error(k, "error", last)
        raise SourceError(f"{self.name} GET {path} failed: {last}")

    def _record_error(self, k, kind, detail):
        # Only the recorder sees errors (so replay reproduces them); they are never cached for live use.
        if self.cache.recorder is not None:
            self.cache.recorder[k] = {"__error__": kind, "detail": detail}

    def snapshot(self) -> dict:
        net = max(1, self.stats["calls"])
        s = {k: v for k, v in self.stats.items() if k != "latency_ms_sum"}
        s["avg_latency_ms"] = round(self.stats["latency_ms_sum"] / net, 1) if self.stats["calls"] else None
        s["breaker"] = self.breaker.snapshot()
        return s
