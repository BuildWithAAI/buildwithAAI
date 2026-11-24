"""Blofin PUBLIC market data (no API keys, no auth, no order endpoints).
/market/candles is intermittently Cloudflare-challenged from this box; on failure candles fall back to Binance public spot klines
(data-api.binance.vision), labelled source='binance_vision_spot' - spot, not perp, prices."""
from __future__ import annotations
import time
import requests
from .base import Adapter, AdapterError

UA = {"User-Agent": "aai-pipeline/0.1 (read-only market data)"}
BAR_MAP = {"1m": "1m", "5m": "5m", "15m": "15m", "1H": "1h", "4H": "4h", "1D": "1d"}


def _f(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


class BlofinAdapter(Adapter):
    name, sector, venue = "blofin_public", "perps", "blofin"

    def __init__(self, cfg, store=None, session=None):
        super().__init__(cfg, store)
        self.c = cfg["adapters"]["blofin"]
        self.http = session or requests.Session()

    def _get(self, url, params=None):
        try:
            r = self.http.get(url, params=params, headers=UA, timeout=self.c["timeout_sec"])
        except requests.RequestException as e:
            raise AdapterError(f"GET {url} failed: {e}")
        ctype = r.headers.get("content-type", "")
        if r.status_code != 200 or "json" not in ctype:
            raise AdapterError(f"GET {url} -> {r.status_code} {ctype} (Cloudflare challenge?)" if "html" in ctype else f"GET {url} -> {r.status_code}")
        return r.json()

    def _blofin(self, path, params=None):
        j = self._get(self.c["base_url"] + "/api/v1" + path, params)
        if str(j.get("code")) != "0":
            raise AdapterError(f"blofin {path} code={j.get('code')} msg={j.get('msg')}")
        return j["data"]

    # ---- normalized fetchers (persist when a store is attached)
    def instruments(self, inst_type="SWAP") -> list[dict]:
        out = []
        for d in self._blofin("/market/instruments", {"instType": inst_type}):
            n = {"venue": self.venue, "symbol": d["instId"], "sector": self.sector, "inst_type": d.get("instType"),
                 "base": d.get("baseCurrency"), "quote": d.get("quoteCurrency"), "contract_value": _f(d.get("contractValue")),
                 "lot_size": _f(d.get("lotSize")), "min_size": _f(d.get("minSize")), "tick_size": _f(d.get("tickSize")),
                 "max_leverage": _f(d.get("maxLeverage")), "state": d.get("state"), "raw": d}
            out.append(n)
        if self.store is not None:
            for n in out:
                self.store.upsert_instrument(n)
        return out

    def ticker(self, symbol: str) -> dict:
        d = self._blofin("/market/tickers", {"instId": symbol})
        if not d:
            raise AdapterError(f"no ticker for {symbol}")
        d = d[0]
        q = {"venue": self.venue, "symbol": symbol, "ts": _f(d.get("ts")) / 1000, "last": _f(d.get("last")),
             "bid": _f(d.get("bidPrice")), "ask": _f(d.get("askPrice")), "vol24h": _f(d.get("vol24h")),
             "open24h": _f(d.get("open24h")), "high24h": _f(d.get("high24h")), "low24h": _f(d.get("low24h")), "source": "blofin_public"}
        try:
            m = self._blofin("/market/mark-price", {"instId": symbol})[0]
            q["mark"], q["index_px"] = _f(m.get("markPrice")), _f(m.get("indexPrice"))
        except (AdapterError, IndexError):
            q["mark"] = q["index_px"] = None
        if self.store is not None:
            self.store.insert_quote(q)
        return q

    def funding(self, symbol: str) -> dict:
        d = self._blofin("/market/funding-rate", {"instId": symbol})[0]
        f = {"venue": self.venue, "symbol": symbol, "ts": time.time(), "rate": _f(d.get("fundingRate")),
             "next_funding_ts": (_f(d.get("fundingTime")) or 0) / 1000, "interval_h": _f(d.get("fundingInterval")), "source": "blofin_public"}
        if self.store is not None:
            self.store.insert_funding(f)
        return f

    def orderbook(self, symbol: str, size=5) -> dict:
        d = self._blofin("/market/books", {"instId": symbol, "size": size})[0]
        bids = [[_f(p), _f(s)] for p, s, *_ in d.get("bids", [])]
        asks = [[_f(p), _f(s)] for p, s, *_ in d.get("asks", [])]
        mid = (bids[0][0] + asks[0][0]) / 2 if bids and asks else None
        return {"symbol": symbol, "bids": bids, "asks": asks, "mid": mid,
                "spread_bps": ((asks[0][0] - bids[0][0]) / mid * 1e4) if mid else None, "ts": _f(d.get("ts"))}

    def candles(self, symbol: str, bar="1H", limit=200) -> dict:
        """Try Blofin; on failure fall back to Binance public spot klines. Returns {source, rows, fallback_reason}."""
        rows, src, why = None, "blofin_public", None
        try:
            data = self._blofin("/market/candles", {"instId": symbol, "bar": bar, "limit": limit})
            rows = [{"ts": _f(k[0]) / 1000, "o": _f(k[1]), "h": _f(k[2]), "l": _f(k[3]), "c": _f(k[4]), "v": _f(k[5])} for k in data]
        except AdapterError as e:
            why = str(e)
            if self.c.get("candle_fallback") != "binance_vision":
                raise
            sym = symbol.replace("-", "")
            data = self._get(self.c["binance_vision_url"] + "/api/v3/klines", {"symbol": sym, "interval": BAR_MAP.get(bar, bar), "limit": limit})
            rows = [{"ts": k[0] / 1000, "o": _f(k[1]), "h": _f(k[2]), "l": _f(k[3]), "c": _f(k[4]), "v": _f(k[5])} for k in data]
            src = "binance_vision_spot"
        rows.sort(key=lambda r: r["ts"])
        if self.store is not None:
            self.store.upsert_candles([{**r, "venue": self.venue, "symbol": symbol, "tf": bar, "source": src} for r in rows])
        return {"symbol": symbol, "tf": bar, "source": src, "fallback_reason": why, "rows": rows}

    def scan(self, symbols: list[str]) -> list[dict]:
        """Market-context snapshot per symbol (data only, NOT a trade signal)."""
        out = []
        for s in symbols:
            try:
                q, f, b = self.ticker(s), self.funding(s), self.orderbook(s)
                chg = (q["last"] / q["open24h"] - 1) if q.get("open24h") else None
                out.append({"symbol": s, "last": q["last"], "mark": q["mark"], "chg24h": chg, "funding_rate": f["rate"],
                            "spread_bps": b["spread_bps"], "vol24h": q["vol24h"], "ok": True})
            except AdapterError as e:
                out.append({"symbol": s, "ok": False, "error": str(e)})
        return out

    def health(self) -> dict:
        t = time.time()
        try:
            q = self.ticker("BTC-USDT")
            ok = bool(q["last"]) and abs(time.time() - q["ts"]) < 300
            return {"ok": ok, "status": "pass" if ok else "stale", "last": q["last"], "quote_age_s": round(time.time() - q["ts"], 1),
                    "ms": int((time.time() - t) * 1000), "note": "candles: Blofin first, binance_vision spot fallback if Cloudflare-challenged"}
        except AdapterError as e:
            return {"ok": False, "status": "error", "detail": str(e), "ms": int((time.time() - t) * 1000)}
