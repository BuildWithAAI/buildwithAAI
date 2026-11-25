"""Parquet-backed market data store with idempotent upserts (dedupe on ts).

Layout:  {data_dir}/{exchange}/ohlcv/{SYMBOL}/{TF}.parquet
         {data_dir}/{exchange}/funding/{SYMBOL}.parquet
         {data_dir}/{exchange}/open_interest/{SYMBOL}.parquet
         {data_dir}/{exchange}/instruments.json
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import pandas as pd

from ..timeframes import normalize
from .models import FUNDING_COLUMNS, OHLCV_COLUMNS, OI_COLUMNS, InstrumentSpec


class ParquetStore:
    def __init__(self, root: Path | str) -> None:
        self.root = Path(root)

    # ------------------------------------------------------------------ paths
    def ohlcv_path(self, exchange: str, symbol: str, timeframe: str) -> Path:
        return self.root / exchange / "ohlcv" / symbol / f"{normalize(timeframe)}.parquet"

    def funding_path(self, exchange: str, symbol: str) -> Path:
        return self.root / exchange / "funding" / f"{symbol}.parquet"

    def oi_path(self, exchange: str, symbol: str) -> Path:
        return self.root / exchange / "open_interest" / f"{symbol}.parquet"

    def instruments_path(self, exchange: str) -> Path:
        return self.root / exchange / "instruments.json"

    # ------------------------------------------------------------------ io
    @staticmethod
    def _read(path: Path, columns: list[str]) -> pd.DataFrame:
        if not path.exists():
            return pd.DataFrame(columns=columns)
        return pd.read_parquet(path)

    @staticmethod
    def _atomic_write(df: pd.DataFrame, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".parquet.tmp")
        df.to_parquet(tmp, index=False)
        os.replace(tmp, path)

    def _upsert(self, path: Path, new: pd.DataFrame, columns: list[str]) -> pd.DataFrame:
        old = self._read(path, columns)
        frames = [f for f in (old, new[columns] if not new.empty else new) if not f.empty]
        if not frames:
            return pd.DataFrame(columns=columns)
        df = pd.concat(frames, ignore_index=True)
        df["ts"] = df["ts"].astype("int64")
        # keep='last' so a re-fetched (corrected) bar overrides the stored one
        df = df.drop_duplicates("ts", keep="last").sort_values("ts").reset_index(drop=True)
        self._atomic_write(df, path)
        return df

    def upsert_ohlcv(self, exchange: str, symbol: str, timeframe: str, df: pd.DataFrame) -> pd.DataFrame:
        return self._upsert(self.ohlcv_path(exchange, symbol, timeframe), df, OHLCV_COLUMNS)

    def upsert_funding(self, exchange: str, symbol: str, df: pd.DataFrame) -> pd.DataFrame:
        return self._upsert(self.funding_path(exchange, symbol), df, FUNDING_COLUMNS)

    def upsert_oi(self, exchange: str, symbol: str, df: pd.DataFrame) -> pd.DataFrame:
        return self._upsert(self.oi_path(exchange, symbol), df, OI_COLUMNS)

    def load_ohlcv(self, exchange: str, symbol: str, timeframe: str, start: str | None = None,
                   end: str | None = None) -> pd.DataFrame:
        df = self._read(self.ohlcv_path(exchange, symbol, timeframe), OHLCV_COLUMNS)
        if df.empty:
            return df
        df = df.copy()
        df.index = pd.to_datetime(df["ts"], unit="ms", utc=True)
        df.index.name = "time"
        if start:
            df = df[df.index >= pd.Timestamp(start, tz="UTC")]
        if end:
            df = df[df.index < pd.Timestamp(end, tz="UTC")]
        return df

    def load_funding(self, exchange: str, symbol: str) -> pd.DataFrame:
        df = self._read(self.funding_path(exchange, symbol), FUNDING_COLUMNS)
        if not df.empty:
            df = df.copy()
            df.index = pd.to_datetime(df["ts"], unit="ms", utc=True)
        return df

    def load_oi(self, exchange: str, symbol: str) -> pd.DataFrame:
        return self._read(self.oi_path(exchange, symbol), OI_COLUMNS)

    def save_instruments(self, exchange: str, specs: list[InstrumentSpec]) -> None:
        path = self.instruments_path(exchange)
        path.parent.mkdir(parents=True, exist_ok=True)
        existing = self.load_instruments_raw(exchange)
        existing.update({s.symbol: s.to_dict() for s in specs})
        path.write_text(json.dumps(existing, indent=2, sort_keys=True))

    def load_instruments_raw(self, exchange: str) -> dict:
        path = self.instruments_path(exchange)
        return json.loads(path.read_text()) if path.exists() else {}

    def load_instrument(self, exchange: str, symbol: str) -> InstrumentSpec:
        raw = self.load_instruments_raw(exchange)
        if symbol not in raw:
            raise KeyError(f"no stored instrument spec for {exchange}:{symbol}; run `perps backfill` first")
        return InstrumentSpec(**raw[symbol])
