"""Incremental historical backfill: instruments, OHLCV, funding history, open-interest snapshots."""

from __future__ import annotations

import json
import logging
from pathlib import Path

import pandas as pd

from ..timeframes import ms as tf_ms
from .adapters.base import ExchangeAdapter, now_ms
from .quality import check_funding, check_ohlcv
from .store import ParquetStore

log = logging.getLogger(__name__)
DAY_MS = 86_400_000


def resolve_universe(adapter: ExchangeAdapter, base: list[str], top_extra: int, min_quote_vol: float) -> list[str]:
    symbols = list(dict.fromkeys(base))
    if top_extra <= 0:
        return symbols
    tick = adapter.fetch_tickers()
    tick = tick[(tick["quote_volume_24h"] >= min_quote_vol) & (~tick["symbol"].isin(symbols))]
    extra = tick.sort_values("quote_volume_24h", ascending=False)["symbol"].head(top_extra).tolist()
    return symbols + extra


def backfill_symbol(adapter: ExchangeAdapter, store: ParquetStore, symbol: str, days_by_tf: dict[str, int],
                    end_ms: int | None = None) -> dict:
    ex = adapter.name
    end_ms = end_ms or now_ms()
    out: dict = {"symbol": symbol, "ohlcv": {}, "funding": None, "open_interest": None}
    spec = adapter.fetch_instrument(symbol)
    store.save_instruments(ex, [spec])
    for tf, days in days_by_tf.items():
        if days <= 0:
            continue
        start = end_ms - days * DAY_MS
        existing = store.load_ohlcv(ex, symbol, tf)
        frames = []
        if not existing.empty:
            first, last = int(existing["ts"].min()), int(existing["ts"].max())
            if first > start + tf_ms(tf):  # extend history backwards
                frames.append(adapter.fetch_candles(symbol, tf, start, first))
            frames.append(adapter.fetch_candles(symbol, tf, last - 2 * tf_ms(tf), None))  # forward refresh
        else:
            frames.append(adapter.fetch_candles(symbol, tf, start, None))
        new = pd.concat([f for f in frames if not f.empty], ignore_index=True) if any(not f.empty for f in frames) \
            else pd.DataFrame()
        df = store.upsert_ohlcv(ex, symbol, tf, new) if not new.empty else existing.reset_index(drop=True)
        rep = check_ohlcv(df, symbol, tf)
        out["ohlcv"][tf] = rep.to_dict()
        if rep.first and pd.Timestamp(rep.first).value // 1_000_000 > start + 2 * DAY_MS:
            rep_note = f"history starts {rep.first}, later than requested {days}d (venue retention limit?)"
            out["ohlcv"][tf]["notes"].append(rep_note)
        log.info("%s %s %s: %d rows, coverage %.4f", ex, symbol, tf, rep.rows, rep.coverage)
    fstart = end_ms - max(days_by_tf.values()) * DAY_MS
    fund = adapter.fetch_funding_history(symbol, fstart, None)
    fdf = store.upsert_funding(ex, symbol, fund) if not fund.empty else store.load_funding(ex, symbol)
    out["funding"] = check_funding(fdf, spec.funding_interval_hours)
    oi = adapter.fetch_open_interest(symbol)
    odf = store.upsert_oi(ex, symbol, oi) if not oi.empty else store.load_oi(ex, symbol)
    out["open_interest"] = {"rows": int(len(odf)),
                            "note": "Blofin exposes OI snapshots only; history accrues from repeated runs"
                            if ex == "blofin" else ""}
    return out


def write_quality_report(results: list[dict], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(results, indent=2, default=str))
