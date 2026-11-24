"""Public Binance market-data client (klines only). No API keys, no trading endpoints.

Uses https://data-api.binance.vision, Binance's public market-data-only mirror
(api.binance.com is geo-blocked from the box).
"""
from __future__ import annotations

import time
from collections.abc import Callable
from typing import Any

import requests

from ..logging_utils import get_logger

log = get_logger(__name__)

INTERVAL_MS = {"1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000}
ALLOWED_PATH = "/api/v3/klines"


class BinanceKlinesClient:
    def __init__(self, base_url: str, timeout_s: float = 20.0, pause_s: float = 0.15,
                 session: Any | None = None, sleep: Callable[[float], None] = time.sleep):
        self.base_url = base_url.rstrip("/")
        self.timeout_s, self.pause_s = timeout_s, pause_s
        self.session = session or requests.Session()
        self.sleep = sleep

    def _get(self, params: dict[str, Any]) -> list[list[Any]]:
        for attempt in range(5):
            r = self.session.get(self.base_url + ALLOWED_PATH, params=params, timeout=self.timeout_s)
            if r.status_code in (429, 418) or r.status_code >= 500:
                wait = 2 ** attempt
                log.warning("binance backoff", extra={"status": r.status_code, "wait_s": wait})
                self.sleep(wait)
                continue
            r.raise_for_status()
            return r.json()
        raise RuntimeError("Binance klines request failed after retries")

    def fetch(self, symbol: str, interval: str, start_ms: int, end_ms: int | None = None) -> list[list[Any]]:
        """All klines with open_time >= start_ms (paginated, 1000/request)."""
        step = INTERVAL_MS[interval]
        out: list[list[Any]] = []
        cur = start_ms
        while True:
            params: dict[str, Any] = {"symbol": symbol, "interval": interval, "startTime": cur, "limit": 1000}
            if end_ms is not None:
                params["endTime"] = end_ms
            rows = self._get(params)
            if not rows:
                break
            out.extend(rows)
            nxt = int(rows[-1][0]) + step
            if len(rows) < 1000 or (end_ms is not None and nxt > end_ms):
                break
            cur = nxt
            self.sleep(self.pause_s)
        return out
