"""Market-data facade: update cache, gap checks, aligned frames for the engine."""
from __future__ import annotations

import time
from dataclasses import dataclass

import numpy as np
import pandas as pd

from ..config import Settings
from ..logging_utils import get_logger
from .binance import INTERVAL_MS, BinanceKlinesClient
from .cache import KlineCache

log = get_logger(__name__)


def symbol_for(asset: str, quote: str = "USDT") -> str:
    return f"{asset}{quote}"


def update_cache(settings: Settings, client: BinanceKlinesClient | None = None,
                 now_ms: int | None = None) -> dict[str, int]:
    cache = KlineCache(settings.paths.cache_db)
    client = client or BinanceKlinesClient(settings.market.base_url, settings.market.timeout_s,
                                           settings.market.request_pause_s)
    now_ms = now_ms or int(time.time() * 1000)
    start_default = int(pd.Timestamp(settings.market.history_start, tz="UTC").timestamp() * 1000)
    added: dict[str, int] = {}
    for asset in settings.assets:
        sym = symbol_for(asset, settings.market.quote)
        for iv in settings.market.intervals:
            last = cache.last_open_time(sym, iv)
            start = start_default if last is None else last + INTERVAL_MS[iv]
            rows = client.fetch(sym, iv, start)
            n = cache.upsert(sym, iv, rows, now_ms=now_ms)
            added[f"{sym}:{iv}"] = n
            log.info("klines cached", extra={"symbol": sym, "interval": iv, "added": n})
    return added


def gap_report(df: pd.DataFrame, interval: str) -> dict:
    if df.empty:
        return {"rows": 0, "gaps": 0, "missing_bars": 0, "first": None, "last": None, "gap_list": []}
    step = INTERVAL_MS[interval]
    ot = df["open_time"].to_numpy()
    d = np.diff(ot)
    idx = np.where(d != step)[0]
    gaps = [
        {"after": pd.Timestamp(int(ot[i]), unit="ms", tz="UTC").isoformat(),
         "missing_bars": int(d[i] // step - 1)}
        for i in idx
    ]
    return {
        "rows": int(len(df)),
        "first": df.index[0].isoformat(),
        "last": df.index[-1].isoformat(),
        "gaps": len(gaps),
        "missing_bars": int(sum(g["missing_bars"] for g in gaps)),
        "gap_list": gaps[:20],
    }


@dataclass
class MarketData:
    """Per-asset 1h/1d frames with ATR; read-only after construction."""

    h1: dict[str, pd.DataFrame]
    d1: dict[str, pd.DataFrame]

    @classmethod
    def from_cache(cls, settings: Settings) -> "MarketData":
        cache = KlineCache(settings.paths.cache_db)
        h1, d1 = {}, {}
        for a in settings.assets:
            sym = symbol_for(a, settings.market.quote)
            h1[a] = add_atr(cache.load(sym, "1h"), settings.strategy.atr_period)
            d1[a] = cache.load(sym, "1d")
        return cls(h1=h1, d1=d1)

    def gap_reports(self) -> dict[str, dict]:
        out = {}
        for a, df in self.h1.items():
            out[f"{a}:1h"] = gap_report(df, "1h")
        for a, df in self.d1.items():
            out[f"{a}:1d"] = gap_report(df, "1d")
        return out


def add_atr(df: pd.DataFrame, period: int = 14) -> pd.DataFrame:
    if df.empty:
        df["atr"] = []
        return df
    prev_close = df["close"].shift(1)
    tr = pd.concat([df["high"] - df["low"], (df["high"] - prev_close).abs(), (df["low"] - prev_close).abs()],
                   axis=1).max(axis=1)
    out = df.copy()
    out["atr"] = tr.ewm(alpha=1.0 / period, adjust=False, min_periods=period).mean()
    return out
