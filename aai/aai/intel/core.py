"""Intel core: HTTP fetcher (timeouts, retries with exponential backoff), per-feed circuit breaker, Feed spec.

Everything fetched here is UNTRUSTED external data. Adapters only extract numbers and short display strings, and
every string goes through aai.guard.clean before it is stored. Nothing in a response can trigger an action.
"""
from __future__ import annotations
import random, time
from dataclasses import dataclass, field
from typing import Any, Callable

import requests

DEFAULT_UA = "Mozilla/5.0 (X11; Linux x86_64) Zoora-AAI-Terminal/1.0 (read-only research terminal)"
MAX_BYTES = 12 * 1024 * 1024   # refuse absurd bodies


class FetchError(Exception):
    """A source failed. `reason` is short and display-safe (no response bodies)."""

    def __init__(self, reason: str, status: int | None = None, retryable: bool = True):
        super().__init__(reason)
        self.reason, self.status, self.retryable = reason, status, retryable


class Fetcher:
    """requests wrapper. GET only, no cookies kept between sources, hard timeouts, bounded retries."""

    def __init__(self, user_agent: str = DEFAULT_UA, timeout: float = 15.0, retries: int = 2, backoff: float = 0.8,
                 sleep: Callable[[float], None] = time.sleep):
        self.ua, self.timeout, self.retries, self.backoff, self.sleep = user_agent, timeout, retries, backoff, sleep
        self.calls = 0

    def get(self, url: str, params: dict | None = None, as_: str = "json", timeout: float | None = None,
            headers: dict | None = None, retries: int | None = None) -> Any:
        h = {"User-Agent": self.ua, "Accept": "application/json, text/csv, application/xml, text/xml, */*;q=0.5",
             "Accept-Encoding": "gzip, deflate"}
        h.update(headers or {})
        tries = 1 + (self.retries if retries is None else retries)
        last: FetchError | None = None
        for i in range(tries):
            if i:
                self.sleep(self.backoff * (2 ** (i - 1)) * (1 + random.random() * 0.25))
            self.calls += 1
            try:
                r = requests.get(url, params=params, headers=h, timeout=timeout or self.timeout, allow_redirects=True)
            except requests.Timeout:
                last = FetchError(f"timeout after {timeout or self.timeout:.0f}s"); continue
            except requests.RequestException as e:
                last = FetchError(f"network error: {type(e).__name__}"); continue
            if r.status_code == 429 or r.status_code >= 500:
                last = FetchError(f"HTTP {r.status_code}", r.status_code); continue
            if r.status_code >= 400:
                hint = " (geo-blocked or bot-challenged)" if r.status_code in (403, 451) else ""
                raise FetchError(f"HTTP {r.status_code}{hint}", r.status_code, retryable=False)
            if len(r.content) > MAX_BYTES:
                raise FetchError(f"response too large ({len(r.content)} bytes)", r.status_code, retryable=False)
            if as_ == "json":
                try:
                    return r.json()
                except ValueError:
                    ct = (r.headers.get("content-type") or "?").split(";")[0]
                    raise FetchError(f"expected JSON, got {ct}", r.status_code, retryable=False)
            if as_ == "bytes":
                return r.content
            return r.text
        raise last or FetchError("unknown fetch failure")


@dataclass
class Breaker:
    """Opens after `threshold` consecutive failures; cool-off doubles per extra failure (capped). Half-open on expiry."""
    threshold: int = 3
    base_cooloff: float = 60.0
    max_cooloff: float = 1800.0

    def cooloff(self, fails: int) -> float:
        if fails < self.threshold:
            return 0.0
        return min(self.max_cooloff, self.base_cooloff * (2 ** (fails - self.threshold)))


@dataclass
class Feed:
    name: str
    label: str
    source: str                 # human-readable source name
    url: str                    # public page / endpoint root shown in the HUD
    interval: float             # seconds between refreshes
    budget: float               # staleness budget: data older than this is STALE
    fn: Callable[..., dict]     # fn(fetcher, cfg, prev_payload) -> payload dict (raises FetchError on failure)
    sector: str = "macro"
    note: str = ""
    breaker: Breaker = field(default_factory=Breaker)

    def meta(self) -> dict:
        return {"feed": self.name, "label": self.label, "source": self.source, "url": self.url, "interval_sec": self.interval,
                "budget_sec": self.budget, "sector": self.sector, "note": self.note}


def num(v) -> float | None:
    """Parse a number from an untrusted field; anything else -> None (never 0)."""
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v) if v == v and abs(v) != float("inf") else None
    try:
        s = str(v).strip().replace(",", "")
        if not s or s in (".", "-", "N/A", "NA", "null"):
            return None
        f = float(s)
        return f if f == f and abs(f) != float("inf") else None
    except ValueError:
        return None


def now() -> float:
    return time.time()
