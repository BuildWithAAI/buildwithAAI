"""Local CSV provider (e.g. exported broker history or Dukascopy tick-to-bar
exports). Expects columns: time/ts/date, open, high, low, close[, volume].
File layout: <root>/<PAIR>_<TF>.csv. Timestamps assumed UTC unless tz-aware."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

import pandas as pd

from .base import DataProvider, ProviderError, Timeframe
from .validation import normalize_ohlcv


class CSVProvider(DataProvider):
    name = "csv"

    def __init__(self, root: str | Path) -> None:
        self.root = Path(root)

    def fetch(self, pair: str, timeframe: Timeframe, start: datetime | None = None,
              end: datetime | None = None) -> pd.DataFrame:
        p = self.root / f"{pair}_{timeframe.value}.csv"
        if not p.exists():
            raise ProviderError(f"missing {p}")
        raw = pd.read_csv(p)
        tcol = next((c for c in raw.columns if c.lower() in ("time", "ts", "date", "datetime", "timestamp")), None)
        if tcol is None:
            raise ProviderError("no time column")
        raw = raw.set_index(pd.to_datetime(raw.pop(tcol), utc=True))
        df = normalize_ohlcv(raw)
        if start is not None:
            df = df[df.index >= pd.Timestamp(start)]
        if end is not None:
            df = df[df.index < pd.Timestamp(end)]
        return df
