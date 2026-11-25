"""US equities / ETFs via Yahoo chart (free, unofficial). Stooq CSV was tried 2026-11-01 and now sits
behind a JavaScript proof-of-work challenge, so it is not usable from scripts. Yahoo chart OHLC is
split-adjusted but NOT dividend-adjusted (adjclose is separate): fine for ATR/vol sizing, not for
total-return analytics.
"""
from __future__ import annotations
import re, time
from ..schema import Series, Quote, norm_candles
from .yahoo import Yahoo


def parse_ticker(sym: str) -> str:
    s = sym.upper().strip().replace(".US", "")
    if not re.fullmatch(r"[A-Z0-9][A-Z0-9.\-^]{0,9}", s):
        raise ValueError(f"bad equity ticker {sym!r}")
    return s.replace(".", "-")   # BRK.B -> BRK-B (Yahoo form)


class EquityFeed:
    def __init__(self, cache, settings):
        self.y = Yahoo(cache, settings.rps["yahoo"])
        self.attempts: list[dict] = []
        self.meta: dict = {}

    def candles(self, symbol, interval="1d", limit=300, now=None) -> Series:
        t = parse_ticker(symbol)
        meta, rows = self.y.chart(t, interval)
        self.meta = meta
        self.attempts.append({"venue": "yahoo", "what": f"candles {interval}", "ok": True})
        c, done = norm_candles(rows, interval, now)
        return Series("equity", t, meta.get("exchangeName") or "yahoo", "yahoo:v8/chart", interval, c[-limit:], complete_last=done)

    def quote(self, symbol) -> Quote:
        t = parse_ticker(symbol)
        meta, _ = self.y.chart(t, "1d", "5d")
        self.meta = meta
        self.attempts.append({"venue": "yahoo", "what": "quote", "ok": True})
        q = Quote("equity", t, meta.get("exchangeName") or "yahoo", "yahoo:v8/chart",
                  int(meta.get("regularMarketTime") or time.time()), meta.get("regularMarketPrice"))
        return q
