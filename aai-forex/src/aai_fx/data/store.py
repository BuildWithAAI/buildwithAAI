"""Parquet OHLCV store: data/<provider>/<TF>/<PAIR>.parquet + .meta.json sidecar.

Writes merge with existing history (new rows win on overlap), so repeated
fetches grow intraday history beyond a provider's rolling window.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import pandas as pd

from .base import OHLCV_COLUMNS, Timeframe
from .validation import to_utc_index


class ParquetStore:
    def __init__(self, root: str | Path) -> None:
        self.root = Path(root)

    def path(self, provider: str, timeframe: Timeframe, pair: str) -> Path:
        return self.root / provider / timeframe.value / f"{pair}.parquet"

    def exists(self, provider: str, timeframe: Timeframe, pair: str) -> bool:
        return self.path(provider, timeframe, pair).exists()

    def write(self, df: pd.DataFrame, provider: str, timeframe: Timeframe, pair: str,
              meta: dict[str, Any] | None = None, merge: bool = True) -> pd.DataFrame:
        p = self.path(provider, timeframe, pair)
        p.parent.mkdir(parents=True, exist_ok=True)
        out = df[OHLCV_COLUMNS].copy()
        if merge and p.exists():
            old = self.read(provider, timeframe, pair)
            out = pd.concat([old, out])
            out = out[~out.index.duplicated(keep="last")].sort_index()
        tmp = p.with_suffix(".parquet.tmp")
        out.to_parquet(tmp, engine="pyarrow")
        os.replace(tmp, p)  # atomic
        if meta is not None:
            m = dict(meta)
            m.update({"rows": len(out), "first_bar": out.index[0].isoformat() if len(out) else None,
                      "last_bar": out.index[-1].isoformat() if len(out) else None})
            p.with_suffix(".meta.json").write_text(json.dumps(m, indent=2, default=str))
        return out

    def read(self, provider: str, timeframe: Timeframe, pair: str,
             start: pd.Timestamp | None = None, end: pd.Timestamp | None = None) -> pd.DataFrame:
        p = self.path(provider, timeframe, pair)
        if not p.exists():
            raise FileNotFoundError(f"No stored data at {p}; run `aai-fx fetch` first")
        df = pd.read_parquet(p, engine="pyarrow")
        df.index = to_utc_index(df.index)
        df.index.name = "ts"
        if start is not None:
            df = df[df.index >= _utc(start)]
        if end is not None:
            df = df[df.index < _utc(end)]
        return df

    def meta(self, provider: str, timeframe: Timeframe, pair: str) -> dict[str, Any]:
        p = self.path(provider, timeframe, pair).with_suffix(".meta.json")
        return json.loads(p.read_text()) if p.exists() else {}


def _utc(t: pd.Timestamp | str) -> pd.Timestamp:
    ts = pd.Timestamp(t)
    return ts.tz_localize("UTC") if ts.tzinfo is None else ts.tz_convert("UTC")
