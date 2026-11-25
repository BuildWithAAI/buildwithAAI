"""Blofin public REST adapter. Docs: https://docs.blofin.com (Public Data section).

Endpoints used (all public, unauthenticated):
  GET /api/v1/market/instruments
  GET /api/v1/market/tickers
  GET /api/v1/market/candles              (bar, after=<ts> returns older records, limit<=1440)
  GET /api/v1/market/funding-rate-history (after=<fundingTime>, limit<=100)
  GET /api/v1/market/funding-rate
  GET /api/v1/market/open-interest        (snapshot only; no public history endpoint)
  GET /api/v1/market/mark-price

Rate limit (docs): 500 req/min per IP (5-min ban), 1500 req/5 min (1-hour ban). We default to
3 req/s which stays well inside both windows.
"""

from __future__ import annotations

import pandas as pd

from ...timeframes import normalize
from ..http import ExchangeAPIError, PublicHttpClient
from ..models import FUNDING_COLUMNS, OHLCV_COLUMNS, OI_COLUMNS, InstrumentSpec
from .base import ExchangeAdapter

BASE_URL = "https://openapi.blofin.com"


class BlofinAdapter(ExchangeAdapter):
    name = "blofin"
    verified_live = True
    candles_page_limit = 1440
    funding_page_limit = 100

    def __init__(self, client: PublicHttpClient | None = None, rate_per_sec: float = 3.0) -> None:
        self.client = client or PublicHttpClient(BASE_URL, rate_per_sec=rate_per_sec, burst=3)

    # ------------------------------------------------------------------ helpers
    def _get(self, path: str, params: dict | None = None) -> list:
        payload = self.client.get(path, params)
        if not isinstance(payload, dict) or str(payload.get("code")) != "0":
            raise ExchangeAPIError(f"blofin {path} error: {str(payload)[:300]}")
        data = payload.get("data")
        return data if isinstance(data, list) else [data]

    @staticmethod
    def to_native(symbol: str) -> str:
        return symbol.upper()

    # ------------------------------------------------------------------ metadata
    def fetch_instruments(self) -> list[InstrumentSpec]:
        out = []
        for r in self._get("/api/v1/market/instruments"):
            if r.get("instType") != "SWAP" or r.get("quoteCurrency") != "USDT" or r.get("contractType") != "linear":
                continue
            out.append(self._parse_instrument(r))
        return out

    def fetch_instrument(self, symbol: str) -> InstrumentSpec:
        rows = self._get("/api/v1/market/instruments", {"instId": self.to_native(symbol)})
        if not rows:
            raise KeyError(f"blofin: instrument {symbol} not found")
        spec = self._parse_instrument(rows[0])
        try:
            fr = self._get("/api/v1/market/funding-rate", {"instId": self.to_native(symbol)})
            if fr:
                interval = float(fr[0].get("fundingInterval") or 8)
                unit = fr[0].get("fundingIntervalUnit", "hour")
                hours = interval / 60 if unit == "minute" else interval
                spec = InstrumentSpec(**{**spec.to_dict(), "funding_interval_hours": hours})
        except ExchangeAPIError:
            pass
        return spec

    @staticmethod
    def _parse_instrument(r: dict) -> InstrumentSpec:
        return InstrumentSpec(
            exchange="blofin",
            symbol=r["instId"],
            exchange_symbol=r["instId"],
            base=r["baseCurrency"],
            quote=r["quoteCurrency"],
            contract_value=float(r["contractValue"]),
            min_size=float(r["minSize"]),
            lot_size=float(r["lotSize"]),
            tick_size=float(r["tickSize"]),
            max_leverage=float(r["maxLeverage"]),
            max_market_size=float(r["maxMarketSize"]) if r.get("maxMarketSize") else None,
            state=r.get("state", "live"),
        )

    def fetch_tickers(self) -> pd.DataFrame:
        rows = self._get("/api/v1/market/tickers")
        recs = []
        for r in rows:
            sym = r.get("instId", "")
            if not sym.endswith("-USDT"):
                continue
            last = float(r.get("last") or 0)
            recs.append({
                "symbol": sym,
                "last": last,
                "bid": float(r.get("bidPrice") or 0),
                "ask": float(r.get("askPrice") or 0),
                "quote_volume_24h": float(r.get("volCurrency24h") or 0) * last,
                "ts": int(r.get("ts") or 0),
            })
        return pd.DataFrame(recs)

    def fetch_mark_price(self, symbol: str) -> float:
        rows = self._get("/api/v1/market/mark-price", {"instId": self.to_native(symbol)})
        return float(rows[0]["markPrice"])

    # ------------------------------------------------------------------ market data
    def fetch_candles_page(self, symbol: str, timeframe: str, end_ms: int | None, limit: int) -> pd.DataFrame:
        params = {"instId": self.to_native(symbol), "bar": normalize(timeframe), "limit": min(limit, 1440)}
        if end_ms is not None:
            params["after"] = int(end_ms)
        rows = self._get("/api/v1/market/candles", params)
        return self.parse_candles(rows)

    @staticmethod
    def parse_candles(rows: list) -> pd.DataFrame:
        if not rows:
            return pd.DataFrame(columns=OHLCV_COLUMNS)
        recs = []
        for r in rows:
            if len(r) >= 9 and str(r[8]) != "1":
                continue  # unconfirmed (still-forming) candle: never stored -> prevents lookahead
            recs.append((int(r[0]), float(r[1]), float(r[2]), float(r[3]), float(r[4]),
                         float(r[6]) if len(r) > 6 else float(r[5]),
                         float(r[7]) if len(r) > 7 else float("nan")))
        df = pd.DataFrame(recs, columns=OHLCV_COLUMNS)
        return df.sort_values("ts").reset_index(drop=True)

    def fetch_funding_page(self, symbol: str, end_ms: int | None, limit: int) -> pd.DataFrame:
        params = {"instId": self.to_native(symbol), "limit": min(limit, 100)}
        if end_ms is not None:
            params["after"] = int(end_ms)
        rows = self._get("/api/v1/market/funding-rate-history", params)
        if not rows:
            return pd.DataFrame(columns=FUNDING_COLUMNS)
        df = pd.DataFrame([(int(r["fundingTime"]), float(r["fundingRate"])) for r in rows], columns=FUNDING_COLUMNS)
        return df.sort_values("ts").reset_index(drop=True)

    def fetch_current_funding(self, symbol: str) -> dict | None:
        rows = self._get("/api/v1/market/funding-rate", {"instId": self.to_native(symbol)})
        if not rows:
            return None
        r = rows[0]
        interval = float(r.get("fundingInterval") or 8)
        hours = interval / 60 if r.get("fundingIntervalUnit") == "minute" else interval
        return {"funding_rate": float(r["fundingRate"]), "funding_time_ms": int(r["fundingTime"]),
                "interval_hours": hours}

    def fetch_open_interest(self, symbol: str) -> pd.DataFrame:
        rows = self._get("/api/v1/market/open-interest", {"instId": self.to_native(symbol)})
        recs = [(int(r["ts"]), float(r["openInterest"]), float(r.get("openInterestCurrency") or "nan")) for r in rows]
        return pd.DataFrame(recs, columns=OI_COLUMNS)
