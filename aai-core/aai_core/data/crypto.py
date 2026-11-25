"""Crypto USDT-margined perpetuals: Bybit v5, Blofin, OKX public market APIs (no keys, GET only).

Verified from this box on 2026-11-01: Blofin and OKX OK. Bybit returns HTTP 403 (CloudFront geo-block)
from this box's region; the adapter follows the documented v5 response format and is exercised
by an offline fixture only. Failover order defaults to bybit -> blofin -> okx (AAI_PERP_VENUES).
"""
from __future__ import annotations
import re, time
from ..schema import Series, Quote, norm_candles
from ..infra.http import HttpSource, SourceError, SourceBlocked

# "latest N candles" requests change as bars close, so they get a short TTL per interval.
KLINE_TTL = {"1m": 20, "5m": 60, "15m": 120, "1h": 300, "4h": 900, "1d": 1800}
QUOTE_TTL = 3


def parse_symbol(sym: str) -> tuple[str, str]:
    """'BTC', 'btcusdt', 'BTC-USDT', 'BTC/USDT', 'BTC-USDT-SWAP', 'BTCUSDT.P' -> ('BTC', 'USDT')."""
    s = sym.upper().strip().replace("/", "-").replace("_", "-")
    s = re.sub(r"(-SWAP|\.P|-PERP|PERP)$", "", s)
    if "-" in s:
        b, q = s.split("-")[:2]
        return b, q
    for q in ("USDT", "USDC", "USD"):
        if s.endswith(q) and len(s) > len(q):
            return s[: -len(q)], q
    return s, "USDT"


def _f(x):
    try:
        return float(x) if x not in (None, "") else None
    except (TypeError, ValueError):
        return None


class _Venue:
    name = "?"

    def _depth(self, bids, asks, mult: float = 1.0, levels: int = 20) -> dict:
        b = sum(float(p) * float(s) * mult for p, s, *_ in bids[:levels])
        a = sum(float(p) * float(s) * mult for p, s, *_ in asks[:levels])
        return {"levels": min(levels, len(bids), len(asks)), "bid_notional": round(b, 2), "ask_notional": round(a, 2)}


class Bybit(_Venue):
    name = "bybit"
    IV = {"1m": "1", "5m": "5", "15m": "15", "1h": "60", "4h": "240", "1d": "D"}

    def __init__(self, cache, rps):
        self.h = HttpSource("bybit", "https://api.bybit.com", rps, cache)

    def _get(self, path, params, ttl):
        j = self.h.get(path, params, ttl)
        if not isinstance(j, dict) or j.get("retCode") != 0:
            raise SourceError(f"bybit {path}: retCode={j.get('retCode') if isinstance(j, dict) else '?'} {str(j)[:120]}")
        return j["result"]

    def candles(self, base, quote, interval, limit):
        r = self._get("/v5/market/kline", {"category": "linear", "symbol": base + quote, "interval": self.IV[interval], "limit": limit}, KLINE_TTL[interval])
        rows = [[int(x[0]) // 1000, x[1], x[2], x[3], x[4], x[5]] for x in r.get("list") or []]
        return rows

    def quote(self, base, quote, levels=20):
        sym = base + quote
        t = (self._get("/v5/market/tickers", {"category": "linear", "symbol": sym}, QUOTE_TTL).get("list") or [None])[0]
        if not t:
            raise SourceError(f"bybit: unknown symbol {sym}")
        ob = self._get("/v5/market/orderbook", {"category": "linear", "symbol": sym, "limit": max(levels, 25)}, QUOTE_TTL)
        inst = (self._get("/v5/market/instruments-info", {"category": "linear", "symbol": sym}, 3600).get("list") or [{}])[0]
        fi_min = _f(inst.get("fundingInterval"))
        return Quote("crypto_perp", f"{base}-{quote}", self.name, "bybit:v5/market", int(time.time()),
                     _f(t.get("lastPrice")), _f(t.get("bid1Price")), _f(t.get("ask1Price")),
                     self._depth(ob.get("b") or [], ob.get("a") or [], 1.0, levels),
                     {"funding_rate": _f(t.get("fundingRate")), "funding_interval_h": (fi_min / 60) if fi_min else None,
                      "next_funding_ts": int(_f(t.get("nextFundingTime")) or 0) // 1000 or None,
                      "open_interest_base": _f(t.get("openInterest")), "open_interest_usd": _f(t.get("openInterestValue")),
                      "volume_24h_quote": _f(t.get("turnover24h"))})


class Blofin(_Venue):
    name = "blofin"
    IV = {"1m": "1m", "5m": "5m", "15m": "15m", "1h": "1H", "4h": "4H", "1d": "1D"}

    def __init__(self, cache, rps):
        self.h = HttpSource("blofin", "https://openapi.blofin.com", rps, cache)

    def _get(self, path, params, ttl):
        j = self.h.get(path, params, ttl)
        if not isinstance(j, dict) or str(j.get("code")) != "0":
            raise SourceError(f"blofin {path}: code={j.get('code') if isinstance(j, dict) else '?'} {str(j)[:120]}")
        return j["data"]

    def candles(self, base, quote, interval, limit):
        d = self._get("/api/v1/market/candles", {"instId": f"{base}-{quote}", "bar": self.IV[interval], "limit": limit}, KLINE_TTL[interval])
        # [ts, o, h, l, c, vol(contracts), volCurrency(base), volCurrencyQuote, confirm]
        return [[int(x[0]) // 1000, x[1], x[2], x[3], x[4], x[6]] for x in d]

    def quote(self, base, quote, levels=20):
        inst_id = f"{base}-{quote}"
        t = (self._get("/api/v1/market/tickers", {"instId": inst_id}, QUOTE_TTL) or [None])[0]
        if not t:
            raise SourceError(f"blofin: unknown instrument {inst_id}")
        inst = (self._get("/api/v1/market/instruments", {"instId": inst_id}, 3600) or [{}])[0]
        cv = _f(inst.get("contractValue")) or 1.0
        ob = (self._get("/api/v1/market/books", {"instId": inst_id, "size": levels}, QUOTE_TTL) or [{}])[0]
        fr = (self._get("/api/v1/market/funding-rate", {"instId": inst_id}, 60) or [{}])[0]
        oi = (self._get("/api/v1/market/open-interest", {"instId": inst_id}, 60) or [{}])[0]
        last = _f(t.get("last"))
        oi_base = _f(oi.get("openInterestCurrency"))
        return Quote("crypto_perp", inst_id, self.name, "blofin:api/v1/market", int(time.time()),
                     last, _f(t.get("bidPrice")), _f(t.get("askPrice")),
                     self._depth(ob.get("bids") or [], ob.get("asks") or [], cv, levels),
                     {"funding_rate": _f(fr.get("fundingRate")), "funding_interval_h": _f(fr.get("fundingInterval")),
                      "next_funding_ts": int(_f(fr.get("fundingTime")) or 0) // 1000 or None,
                      "open_interest_base": oi_base, "open_interest_usd": round(oi_base * last, 2) if oi_base and last else None,
                      "volume_24h_quote": round(_f(t.get("volCurrency24h")) * last, 2) if _f(t.get("volCurrency24h")) and last else None})


class Okx(_Venue):
    name = "okx"
    IV = {"1m": "1m", "5m": "5m", "15m": "15m", "1h": "1H", "4h": "4H", "1d": "1Dutc"}

    def __init__(self, cache, rps):
        self.h = HttpSource("okx", "https://www.okx.com", rps, cache)

    def _get(self, path, params, ttl):
        j = self.h.get(path, params, ttl)
        if not isinstance(j, dict) or str(j.get("code")) != "0":
            raise SourceError(f"okx {path}: code={j.get('code') if isinstance(j, dict) else '?'} {str(j)[:120]}")
        return j["data"]

    def candles(self, base, quote, interval, limit):
        d = self._get("/api/v5/market/candles", {"instId": f"{base}-{quote}-SWAP", "bar": self.IV[interval], "limit": min(limit, 300)}, KLINE_TTL[interval])
        return [[int(x[0]) // 1000, x[1], x[2], x[3], x[4], x[6]] for x in d]

    def quote(self, base, quote, levels=20):
        inst_id = f"{base}-{quote}-SWAP"
        t = (self._get("/api/v5/market/ticker", {"instId": inst_id}, QUOTE_TTL) or [None])[0]
        if not t:
            raise SourceError(f"okx: unknown instrument {inst_id}")
        inst = (self._get("/api/v5/public/instruments", {"instType": "SWAP", "instId": inst_id}, 3600) or [{}])[0]
        cv = _f(inst.get("ctVal")) or 1.0
        ob = (self._get("/api/v5/market/books", {"instId": inst_id, "sz": levels}, QUOTE_TTL) or [{}])[0]
        fr = (self._get("/api/v5/public/funding-rate", {"instId": inst_id}, 60) or [{}])[0]
        oi = (self._get("/api/v5/public/open-interest", {"instType": "SWAP", "instId": inst_id}, 60) or [{}])[0]
        ft, nft = _f(fr.get("fundingTime")), _f(fr.get("nextFundingTime"))
        last = _f(t.get("last"))
        return Quote("crypto_perp", f"{base}-{quote}", self.name, "okx:api/v5", int(time.time()),
                     last, _f(t.get("bidPx")), _f(t.get("askPx")),
                     self._depth(ob.get("bids") or [], ob.get("asks") or [], cv, levels),
                     {"funding_rate": _f(fr.get("fundingRate")),
                      "funding_interval_h": round((nft - ft) / 3.6e6, 2) if ft and nft else None,
                      "next_funding_ts": int(ft) // 1000 if ft else None,
                      "open_interest_base": _f(oi.get("oiCcy")), "open_interest_usd": _f(oi.get("oiUsd")),
                      "volume_24h_quote": round(_f(t.get("volCcy24h")) * last, 2) if _f(t.get("volCcy24h")) and last else None})


VENUES = {"bybit": Bybit, "blofin": Blofin, "okx": Okx}


class PerpFeed:
    """Tries venues in order; the first that answers wins. Every attempt is recorded for transparency."""

    def __init__(self, cache, settings):
        self.venues = {n: VENUES[n](cache, settings.rps[n]) for n in settings.perp_venues if n in VENUES}
        self.attempts: list[dict] = []
        self.blocked: set[str] = set()   # venues that geo-blocked us this session are skipped afterwards

    def _try(self, venue, what, fn):
        order = [venue] if venue and venue != "auto" else list(self.venues)
        errs = []
        for n in order:
            if n in self.blocked and len(order) > 1:
                continue
            v = self.venues.get(n)
            if v is None:
                raise SourceError(f"venue {n!r} not enabled (AAI_PERP_VENUES)")
            try:
                out = fn(v)
                self.attempts.append({"venue": n, "what": what, "ok": True})
                return n, out
            except SourceError as e:
                if isinstance(e, SourceBlocked):
                    self.blocked.add(n)
                self.attempts.append({"venue": n, "what": what, "ok": False, "error": str(e)[:160]})
                errs.append(f"{n}: {e}")
        raise SourceError(f"all perp venues failed for {what}: " + " | ".join(errs))

    def candles(self, symbol, interval="1h", limit=200, venue="auto", now=None) -> Series:
        b, q = parse_symbol(symbol)
        n, rows = self._try(venue, f"candles {interval}", lambda v: v.candles(b, q, interval, limit))
        c, done = norm_candles(rows, interval, now)
        return Series("crypto_perp", f"{b}-{q}", n, f"{n}:klines", interval, c, complete_last=done)

    def quote(self, symbol, venue="auto") -> Quote:
        b, q = parse_symbol(symbol)
        return self._try(venue, "quote", lambda v: v.quote(b, q))[1]

    def stats(self) -> dict:
        return {n: v.h.snapshot() for n, v in self.venues.items()}
