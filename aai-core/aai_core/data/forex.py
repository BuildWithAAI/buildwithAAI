"""Forex majors.

Intraday + daily OHLC: Yahoo chart `EURUSD=X` (unofficial, no volume, no bid/ask).
Daily reference: Frankfurter (ECB reference rates, ~16:00 CET fixing, business days only) at
https://api.frankfurter.dev/v1 (the old api.frankfurter.app now 301-redirects). Used as an independent
cross-check of the Yahoo price and as fallback for daily data.
Neither is a broker feed: real MT5 spreads/swaps/fills need the user's broker (gap, see README).
"""
from __future__ import annotations
import datetime as dt, time
from ..schema import Series, Quote, norm_candles
from ..infra.http import HttpSource, SourceError
from .yahoo import Yahoo

MAJORS = {"EURUSD", "GBPUSD", "USDJPY", "USDCHF", "AUDUSD", "USDCAD", "NZDUSD"}
CROSSES_OK = {"EURGBP", "EURJPY", "GBPJPY", "EURCHF", "AUDJPY", "EURAUD", "CADJPY", "CHFJPY", "AUDNZD", "GBPCHF"}


def parse_pair(sym: str) -> tuple[str, str]:
    s = sym.upper().replace("/", "").replace("-", "").replace("_", "").replace("=X", "")
    if len(s) != 6 or not s.isalpha():
        raise ValueError(f"forex symbol must look like EURUSD or EUR/USD, got {sym!r}")
    return s[:3], s[3:]


class Frankfurter:
    def __init__(self, cache, rps):
        self.h = HttpSource("frankfurter", "https://api.frankfurter.dev/v1", rps, cache)

    def daily(self, base, quote, days=400):
        start = (dt.date.today() - dt.timedelta(days=int(days * 1.5))).isoformat()
        j = self.h.get(f"/{start}..", {"base": base, "symbols": quote}, 3600)
        rows = []
        for d, r in sorted((j.get("rates") or {}).items()):
            ts = int(dt.datetime.fromisoformat(d).replace(tzinfo=dt.timezone.utc).timestamp())
            v = r.get(quote)
            if v is not None:
                rows.append([ts, v, v, v, v, 0])   # fixing only: O=H=L=C
        return rows

    def latest(self, base, quote):
        j = self.h.get("/latest", {"base": base, "symbols": quote}, 900)
        return j.get("date"), (j.get("rates") or {}).get(quote)


class ForexFeed:
    def __init__(self, cache, settings):
        self.y = Yahoo(cache, settings.rps["yahoo"])
        self.f = Frankfurter(cache, settings.rps["frankfurter"])
        self.attempts: list[dict] = []

    def candles(self, symbol, interval="1h", limit=200, now=None) -> Series:
        b, q = parse_pair(symbol)
        try:
            meta, rows = self.y.chart(f"{b}{q}=X", interval)
            c, done = norm_candles(rows, interval, now)
            self.attempts.append({"venue": "yahoo", "what": f"candles {interval}", "ok": True})
            return Series("forex", f"{b}{q}", "yahoo", "yahoo:v8/chart", interval, c[-limit:], complete_last=done)
        except (SourceError, KeyError, TypeError) as e:
            self.attempts.append({"venue": "yahoo", "what": f"candles {interval}", "ok": False, "error": str(e)[:160]})
            if interval != "1d":
                raise
        rows = self.f.daily(b, q, limit)
        c, done = norm_candles(rows, "1d", now)
        self.attempts.append({"venue": "frankfurter", "what": "candles 1d", "ok": True})
        return Series("forex", f"{b}{q}", "ecb", "frankfurter:ecb-reference", "1d", c[-limit:], complete_last=True)

    def quote(self, symbol) -> Quote:
        b, q = parse_pair(symbol)
        meta, rows = self.y.chart(f"{b}{q}=X", "1m", "1d")
        self.attempts.append({"venue": "yahoo", "what": "quote", "ok": True})
        last = meta.get("regularMarketPrice")
        return Quote("forex", f"{b}{q}", "yahoo", "yahoo:v8/chart", int(meta.get("regularMarketTime") or time.time()), last)

    def ecb_check(self, symbol) -> dict:
        b, q = parse_pair(symbol)
        try:
            d, r = self.f.latest(b, q)
            self.attempts.append({"venue": "frankfurter", "what": "ecb_reference", "ok": True})
            return {"date": d, "rate": r}
        except SourceError as e:
            self.attempts.append({"venue": "frankfurter", "what": "ecb_reference", "ok": False, "error": str(e)[:160]})
            return {"date": None, "rate": None, "error": str(e)[:160]}
