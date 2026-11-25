"""Exchange adapter interface (public market data only)."""

from __future__ import annotations

import abc
import logging
import time

import pandas as pd

from ...timeframes import ms as tf_ms
from ..http import PublicHttpClient
from ..models import FUNDING_COLUMNS, OHLCV_COLUMNS, OI_COLUMNS, InstrumentSpec

log = logging.getLogger(__name__)


def now_ms() -> int:
    return int(time.time() * 1000)


class ExchangeAdapter(abc.ABC):
    """All methods are read-only and hit public endpoints only. Timestamps are epoch ms UTC."""

    name: str = "base"
    #: True if this adapter has been exercised against the live API from this environment.
    verified_live: bool = False
    client: PublicHttpClient

    # ---- metadata ------------------------------------------------------------------------
    @abc.abstractmethod
    def fetch_instruments(self) -> list[InstrumentSpec]: ...

    def fetch_instrument(self, symbol: str) -> InstrumentSpec:
        for spec in self.fetch_instruments():
            if spec.symbol == symbol:
                return spec
        raise KeyError(f"{self.name}: instrument {symbol} not found")

    @abc.abstractmethod
    def fetch_tickers(self) -> pd.DataFrame:
        """Columns: symbol, last, bid, ask, quote_volume_24h, ts."""

    # ---- market data ---------------------------------------------------------------------
    @abc.abstractmethod
    def fetch_candles_page(self, symbol: str, timeframe: str, end_ms: int | None, limit: int) -> pd.DataFrame:
        """One page of *closed* candles with ts < end_ms (or latest if None), ascending."""

    @abc.abstractmethod
    def fetch_funding_page(self, symbol: str, end_ms: int | None, limit: int) -> pd.DataFrame:
        """One page of funding records with ts < end_ms, ascending."""

    @abc.abstractmethod
    def fetch_open_interest(self, symbol: str) -> pd.DataFrame:
        """Latest open-interest snapshot (and history where the venue exposes it)."""

    def fetch_current_funding(self, symbol: str) -> dict | None:
        """Current (next-settlement) funding: {funding_rate, funding_time_ms, interval_hours}. None if unsupported."""
        return None

    candles_page_limit: int = 1000
    funding_page_limit: int = 100

    def fetch_candles(self, symbol: str, timeframe: str, start_ms: int, end_ms: int | None = None) -> pd.DataFrame:
        """Backward-paginate closed candles covering [start_ms, end_ms)."""
        cursor = end_ms
        frames: list[pd.DataFrame] = []
        while True:
            page = self.fetch_candles_page(symbol, timeframe, cursor, self.candles_page_limit)
            if page.empty:
                break
            frames.append(page)
            oldest = int(page["ts"].iloc[0])
            if oldest <= start_ms:
                break
            if cursor is not None and oldest >= cursor:  # no progress -> stop (defensive)
                break
            cursor = oldest
            if len(page) < 2:
                break
            log.debug("%s %s %s: paged back to %s", self.name, symbol, timeframe, pd.to_datetime(oldest, unit="ms"))
        if not frames:
            return pd.DataFrame(columns=OHLCV_COLUMNS)
        df = pd.concat(frames, ignore_index=True)
        df = df[df["ts"] >= start_ms]
        if end_ms is not None:
            df = df[df["ts"] < end_ms]
        return df.drop_duplicates("ts").sort_values("ts").reset_index(drop=True)

    def fetch_funding_history(self, symbol: str, start_ms: int, end_ms: int | None = None) -> pd.DataFrame:
        cursor = end_ms
        frames: list[pd.DataFrame] = []
        while True:
            page = self.fetch_funding_page(symbol, cursor, self.funding_page_limit)
            if page.empty:
                break
            frames.append(page)
            oldest = int(page["ts"].iloc[0])
            if oldest <= start_ms or (cursor is not None and oldest >= cursor):
                break
            cursor = oldest
        if not frames:
            return pd.DataFrame(columns=FUNDING_COLUMNS)
        df = pd.concat(frames, ignore_index=True)
        df = df[df["ts"] >= start_ms]
        return df.drop_duplicates("ts").sort_values("ts").reset_index(drop=True)


def empty_oi() -> pd.DataFrame:
    return pd.DataFrame(columns=OI_COLUMNS)
