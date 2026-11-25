"""Rate-limited, retrying HTTP client for PUBLIC market-data endpoints only.

No authentication headers are ever attached. GET only.
"""

from __future__ import annotations

import logging
import random
import threading
import time
from typing import Any

import requests

log = logging.getLogger(__name__)


class ExchangeUnavailable(RuntimeError):
    """Raised when an exchange is unreachable, geo-blocked or persistently rate-limiting us."""


class ExchangeAPIError(RuntimeError):
    """Raised when the exchange returns a well-formed error payload."""


class TokenBucket:
    """Simple thread-safe token bucket: `rate` requests per second with `burst` capacity."""

    def __init__(self, rate: float, burst: int = 1) -> None:
        self.rate = rate
        self.capacity = max(1, burst)
        self.tokens = float(self.capacity)
        self.last = time.monotonic()
        self.lock = threading.Lock()

    def acquire(self) -> None:
        while True:
            with self.lock:
                now = time.monotonic()
                self.tokens = min(self.capacity, self.tokens + (now - self.last) * self.rate)
                self.last = now
                if self.tokens >= 1:
                    self.tokens -= 1
                    return
                wait = (1 - self.tokens) / self.rate
            time.sleep(wait)


class PublicHttpClient:
    """GET-only JSON client with token-bucket throttling and exponential backoff with jitter.

    Retries on 429 / 5xx / network errors / non-JSON (e.g. CDN challenge) bodies. A 403 is treated as a
    firewall / geo block: retried a small number of times with a long pause, then surfaced as
    ExchangeUnavailable so callers can fail gracefully.
    """

    def __init__(
        self,
        base_url: str,
        rate_per_sec: float = 3.0,
        burst: int = 3,
        max_retries: int = 6,
        backoff_base: float = 1.0,
        backoff_cap: float = 120.0,
        timeout: float = 15.0,
        user_agent: str = "perps-pipeline/0.1 (research; public market data)",
        session: requests.Session | None = None,
        sleep=time.sleep,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.bucket = TokenBucket(rate_per_sec, burst)
        self.max_retries = max_retries
        self.backoff_base = backoff_base
        self.backoff_cap = backoff_cap
        self.timeout = timeout
        self.session = session or requests.Session()
        self.session.headers.update({"User-Agent": user_agent, "Accept": "application/json"})
        self._sleep = sleep
        self.request_count = 0

    def _backoff(self, attempt: int, retry_after: float | None = None) -> float:
        if retry_after is not None:
            return min(self.backoff_cap, retry_after)
        delay = min(self.backoff_cap, self.backoff_base * (2**attempt))
        return delay * (0.5 + random.random() / 2)

    def get(self, path: str, params: dict[str, Any] | None = None) -> Any:
        url = f"{self.base_url}{path}"
        clean = {k: v for k, v in (params or {}).items() if v is not None}
        last_err: str = ""
        for attempt in range(self.max_retries + 1):
            self.bucket.acquire()
            self.request_count += 1
            try:
                resp = self.session.get(url, params=clean, timeout=self.timeout)
            except requests.RequestException as e:
                last_err = f"network error: {e}"
                log.warning("GET %s failed (%s); retry %d", path, e, attempt)
                self._sleep(self._backoff(attempt))
                continue
            status = resp.status_code
            if status == 200:
                try:
                    return resp.json()
                except ValueError:
                    last_err = "non-JSON 200 body (CDN challenge?)"
                    self._sleep(self._backoff(attempt))
                    continue
            ra = resp.headers.get("Retry-After")
            retry_after = float(ra) if ra and ra.replace(".", "", 1).isdigit() else None
            if status == 403:
                body = resp.text[:200]
                last_err = f"HTTP 403 (firewall/geo-block): {body!r}"
                if "cloudfront" in resp.text.lower() or "country" in resp.text.lower():
                    raise ExchangeUnavailable(f"{url}: geo-blocked from this network ({last_err})")
                if attempt >= 1:
                    break
                self._sleep(min(self.backoff_cap, 60.0))
                continue
            if status == 429 or status >= 500:
                last_err = f"HTTP {status}"
                delay = self._backoff(attempt + 2, retry_after)
                log.warning("GET %s -> %s; backing off %.1fs", path, status, delay)
                self._sleep(delay)
                continue
            raise ExchangeAPIError(f"GET {url} -> HTTP {status}: {resp.text[:300]}")
        raise ExchangeUnavailable(f"GET {url} failed after {self.max_retries + 1} attempts: {last_err}")
