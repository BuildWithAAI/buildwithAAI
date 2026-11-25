"""Bybit V5 public REST adapter, written against https://bybit-exchange.github.io/docs/v5/intro.

STATUS: UNTESTED LIVE FROM THIS BOX. api.bybit.com returns a CloudFront geo-block (HTTP 403) from the
Phase-1 research box. By design this adapter does NOT try alternate domains or proxies; it raises
ExchangeUnavailable so callers degrade gracefully. Parsing logic is unit-tested against payloads
shaped exactly like the V5 documentation examples. Run `perps backfill --exchange bybit` from an
unblocked machine to validate.

Endpoints used (public, unauthenticated, category=linear):
  GET /v5/market/instruments-info   (cursor pagination, limit<=1000)
  GET /v5/market/tickers
  GET /v5/market/kline              (interval 1,3,5,15,30,60,120,240,360,720,D; start/end; limit<=1000; desc)
  GET /v5/market/funding/history    (startTime/endTime; limit<=200; desc)
  GET /v5/market/open-interest      (intervalTime 5min..1d; startTime/endTime; limit<=200; cursor)
Rate limit (docs): 600 requests / 5 s per IP for HTTP; we default to 5 req/s.
"""

from __future__ import annotations

import pandas as pd

from ...timeframes import minutes, normalize
from ...timeframes import ms as tf_ms
from ..http import ExchangeAPIError, PublicHttpClient
from ..models import FUNDING_COLUMNS, OHLCV_COLUMNS, OI_COLUMNS, InstrumentSpec
from .base import ExchangeAdapter, now_ms

BASE_URL = "https://api.bybit.com"

_INTERVALS = {1: "1", 3: "3", 5: "5", 15: "15", 30: "30", 60: "60", 120: "120", 240: "240",
              360: "360", 720: "720", 1440: "D"}
_OI_INTERVALS = {5: "5min", 15: "15min", 30: "30min", 60: "1h", 240: "4h", 1440: "1d"}


class BybitAdapter(ExchangeAdapter):
    name = "bybit"
    verified_live = False
    candles_page_limit = 1000
    funding_page_limit = 200

    def __init__(self, client: PublicHttpClient | None = None, rate_per_sec: float = 5.0) -> None:
        self.client = client or PublicHttpClient(BASE_URL, rate_per_sec=rate_per_sec, burst=5, max_retries=3)

    def _get(self, path: str, params: dict) -> dict:
        payload = self.client.get(path, params)
        if not isinstance(payload, dict) or payload.get("retCode") != 0:
            raise ExchangeAPIError(f"bybit {path} error: {str(payload)[:300]}")
        return payload.get("result") or {}

    @staticmethod
    def to_native(symbol: str) -> str:
        return symbol.replace("-", "").upper()

    @staticmethod
    def from_native(sym: str, quote: str = "USDT") -> str:
        return f"{sym[: -len(quote)]}-{quote}" if sym.endswith(quote) else sym

    # ------------------------------------------------------------------ metadata
    def fetch_instruments(self) -> list[InstrumentSpec]:
        out: list[InstrumentSpec] = []
        cursor: str | None = None
        while True:
            res = self._get("/v5/market/instruments-info", {"category": "linear", "limit": 1000, "cursor": cursor})
            for r in res.get("list", []):
                if r.get("quoteCoin") == "USDT" and r.get("contractType") == "LinearPerpetual":
                    out.append(self.parse_instrument(r))
            cursor = res.get("nextPageCursor") or None
            if not cursor:
                break
        return out

    def fetch_instrument(self, symbol: str) -> InstrumentSpec:
        res = self._get("/v5/market/instruments-info", {"category": "linear", "symbol": self.to_native(symbol)})
        rows = res.get("list", [])
        if not rows:
            raise KeyError(f"bybit: instrument {symbol} not found")
        return self.parse_instrument(rows[0])

    @classmethod
    def parse_instrument(cls, r: dict) -> InstrumentSpec:
        lot = r.get("lotSizeFilter", {})
        price = r.get("priceFilter", {})
        lev = r.get("leverageFilter", {})
        return InstrumentSpec(
            exchange="bybit",
            symbol=cls.from_native(r["symbol"]),
            exchange_symbol=r["symbol"],
            base=r["baseCoin"],
            quote=r["quoteCoin"],
            contract_value=1.0,  # Bybit linear qty is denominated in base coin
            min_size=float(lot.get("minOrderQty", 0)),
            lot_size=float(lot.get("qtyStep", 0) or lot.get("minOrderQty", 1)),
            tick_size=float(price.get("tickSize", 0)),
            max_leverage=float(lev.get("maxLeverage", 1)),
            max_market_size=float(lot["maxMktOrderQty"]) if lot.get("maxMktOrderQty") else None,
            min_notional=float(lot.get("minNotionalValue", 0) or 0),
            funding_interval_hours=float(r.get("fundingInterval", 480)) / 60.0,
            state="live" if r.get("status") == "Trading" else str(r.get("status", "")).lower(),
        )

    def fetch_tickers(self) -> pd.DataFrame:
        res = self._get("/v5/market/tickers", {"category": "linear"})
        recs = []
        for r in res.get("list", []):
            if not r.get("symbol", "").endswith("USDT"):
                continue
            recs.append({
                "symbol": self.from_native(r["symbol"]),
                "last": float(r.get("lastPrice") or 0),
                "bid": float(r.get("bid1Price") or 0),
                "ask": float(r.get("ask1Price") or 0),
                "quote_volume_24h": float(r.get("turnover24h") or 0),
                "ts": now_ms(),
            })
        return pd.DataFrame(recs)

    # ------------------------------------------------------------------ market data
    def fetch_current_funding(self, symbol: str) -> dict | None:
        """UNTESTED from this box (geo-blocked). /v5/market/tickers carries fundingRate + nextFundingTime."""
        res = self._get("/v5/market/tickers", {"category": "linear", "symbol": self.to_native(symbol)})
        rows = res.get("list") or []
        if not rows or not rows[0].get("fundingRate"):
            return None
        r = rows[0]
        hours = float(r.get("fundingIntervalHour") or 8)
        return {"funding_rate": float(r["fundingRate"]), "funding_time_ms": int(r.get("nextFundingTime") or 0),
                "interval_hours": hours}

    def fetch_candles_page(self, symbol: str, timeframe: str, end_ms: int | None, limit: int) -> pd.DataFrame:
        tf = normalize(timeframe)
        params: dict = {"category": "linear", "symbol": self.to_native(symbol),
                        "interval": _INTERVALS[minutes(tf)], "limit": min(limit, 1000)}
        if end_ms is not None:
            params["end"] = int(end_ms) - 1  # Bybit `end` is inclusive; we want ts < end_ms
        res = self._get("/v5/market/kline", params)
        return self.parse_klines(res.get("list", []), tf)

    @staticmethod
    def parse_klines(rows: list, timeframe: str, now: int | None = None) -> pd.DataFrame:
        if not rows:
            return pd.DataFrame(columns=OHLCV_COLUMNS)
        now = now or now_ms()
        step = tf_ms(timeframe)
        recs = [(int(r[0]), float(r[1]), float(r[2]), float(r[3]), float(r[4]), float(r[5]), float(r[6]))
                for r in rows if int(r[0]) + step <= now]  # drop the still-forming candle
        return pd.DataFrame(recs, columns=OHLCV_COLUMNS).sort_values("ts").reset_index(drop=True)

    def fetch_funding_page(self, symbol: str, end_ms: int | None, limit: int) -> pd.DataFrame:
        params: dict = {"category": "linear", "symbol": self.to_native(symbol), "limit": min(limit, 200)}
        if end_ms is not None:
            params["endTime"] = int(end_ms) - 1
        res = self._get("/v5/market/funding/history", params)
        return self.parse_funding(res.get("list", []))

    @staticmethod
    def parse_funding(rows: list) -> pd.DataFrame:
        if not rows:
            return pd.DataFrame(columns=FUNDING_COLUMNS)
        df = pd.DataFrame([(int(r["fundingRateTimestamp"]), float(r["fundingRate"])) for r in rows],
                          columns=FUNDING_COLUMNS)
        return df.sort_values("ts").reset_index(drop=True)

    def fetch_open_interest(self, symbol: str, timeframe: str = "1H", start_ms: int | None = None,
                            end_ms: int | None = None, max_pages: int = 50) -> pd.DataFrame:
        interval = _OI_INTERVALS.get(minutes(normalize(timeframe)), "1h")
        cursor: str | None = None
        frames = []
        for _ in range(max_pages):
            params: dict = {"category": "linear", "symbol": self.to_native(symbol), "intervalTime": interval,
                            "limit": 200, "startTime": start_ms, "endTime": end_ms, "cursor": cursor}
            res = self._get("/v5/market/open-interest", params)
            rows = res.get("list", [])
            if not rows:
                break
            frames.append(pd.DataFrame([(int(r["timestamp"]), float(r["openInterest"]), float(r["openInterest"]))
                                        for r in rows], columns=OI_COLUMNS))
            cursor = res.get("nextPageCursor") or None
            if not cursor or start_ms is None:
                break
        if not frames:
            return pd.DataFrame(columns=OI_COLUMNS)
        return pd.concat(frames).drop_duplicates("ts").sort_values("ts").reset_index(drop=True)
