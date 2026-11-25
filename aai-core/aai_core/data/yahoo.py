"""Yahoo Finance chart endpoint (unofficial, free, no key). Used for US equities/ETFs and FX intraday.

GET https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval=..&range=..
Verified 2026-11-01 for SPY and EURUSD=X. Unofficial: may change or rate-limit without notice; it does not
provide bid/ask in this endpoint, so spread is unknown (null) for equities/FX.
"""
from __future__ import annotations
from ..infra.http import HttpSource, SourceError, SourceNotFound

IV = {"1m": ("1m", "5d"), "5m": ("5m", "30d"), "15m": ("15m", "30d"), "1h": ("60m", "180d"), "1d": ("1d", "2y")}
TTL = {"1m": 30, "5m": 60, "15m": 120, "1h": 300, "1d": 1800}


class Yahoo:
    def __init__(self, cache, rps):
        self.h = HttpSource("yahoo", "https://query1.finance.yahoo.com", rps, cache)

    def chart(self, ysym: str, interval: str = "1d", rng: str | None = None) -> tuple[dict, list]:
        if interval not in IV:
            raise ValueError(f"yahoo: unsupported interval {interval} (use {list(IV)})")
        yi, default_rng = IV[interval]
        j = self.h.get(f"/v8/finance/chart/{ysym}", {"interval": yi, "range": rng or default_rng, "includePrePost": "false"}, TTL[interval])
        ch = (j or {}).get("chart") or {}
        if ch.get("error"):
            raise SourceNotFound(f"yahoo {ysym}: {ch['error']}")
        res = (ch.get("result") or [None])[0]
        if not res or not res.get("timestamp"):
            raise SourceError(f"yahoo {ysym}: empty chart")
        q = res["indicators"]["quote"][0]
        rows = [[t, q["open"][i], q["high"][i], q["low"][i], q["close"][i], (q.get("volume") or [0] * len(res["timestamp"]))[i] or 0]
                for i, t in enumerate(res["timestamp"])]
        return res.get("meta") or {}, rows
