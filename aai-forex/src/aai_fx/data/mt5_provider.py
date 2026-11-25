"""MetaTrader 5 data provider (STUB for the user's Windows PC).

The ``MetaTrader5`` Python package only ships Windows wheels and talks to a
running MT5 terminal over IPC, so it cannot run on this Linux box. This class
is written against the documented API (``initialize``, ``copy_rates_range``)
but is UNTESTED until run on Windows. Broker server time is usually GMT+2/+3;
MT5 returns bar times as epoch seconds in *server time*, so ``server_utc_offset_hours``
must be set correctly for UTC normalisation.
"""

from __future__ import annotations

import sys
from datetime import datetime, timezone
from typing import Any

import pandas as pd

from .base import DataProvider, ProviderError, Timeframe


class MT5Unavailable(ProviderError):
    pass


_TF_ATTR = {Timeframe.M1: "TIMEFRAME_M1", Timeframe.M5: "TIMEFRAME_M5", Timeframe.M15: "TIMEFRAME_M15",
            Timeframe.M30: "TIMEFRAME_M30", Timeframe.H1: "TIMEFRAME_H1", Timeframe.H4: "TIMEFRAME_H4",
            Timeframe.D1: "TIMEFRAME_D1"}


def import_mt5() -> Any:
    if not sys.platform.startswith("win"):
        raise MT5Unavailable("MetaTrader5 Python API is Windows-only; run this on the Windows PC with MT5.")
    try:
        import MetaTrader5 as mt5
    except ImportError as exc:  # pragma: no cover - windows only
        raise MT5Unavailable("pip install MetaTrader5 (Windows) and start the MT5 terminal") from exc
    return mt5


class MT5Provider(DataProvider):
    name = "mt5"

    def __init__(self, symbol_suffix: str = "", server_utc_offset_hours: float = 0.0) -> None:
        self.symbol_suffix = symbol_suffix  # e.g. ".r" or "m" on some brokers
        self.server_utc_offset_hours = server_utc_offset_hours

    def fetch(self, pair: str, timeframe: Timeframe, start: datetime | None = None,
              end: datetime | None = None) -> pd.DataFrame:  # pragma: no cover - windows only
        mt5 = import_mt5()
        if not mt5.initialize():
            raise MT5Unavailable(f"mt5.initialize() failed: {mt5.last_error()}")
        try:
            sym = pair + self.symbol_suffix
            if not mt5.symbol_select(sym, True):
                raise ProviderError(f"symbol_select({sym}) failed")
            start = start or datetime(2015, 1, 1, tzinfo=timezone.utc)
            end = end or datetime.now(timezone.utc)
            rates = mt5.copy_rates_range(sym, getattr(mt5, _TF_ATTR[timeframe]), start, end)
            if rates is None or len(rates) == 0:
                raise ProviderError(f"no MT5 rates for {sym}: {mt5.last_error()}")
            df = pd.DataFrame(rates)
            idx = pd.to_datetime(df["time"], unit="s", utc=True) - pd.Timedelta(hours=self.server_utc_offset_hours)
            out = pd.DataFrame({"open": df["open"], "high": df["high"], "low": df["low"], "close": df["close"],
                                "volume": df["tick_volume"].astype(float)}).set_index(idx)
            return out
        finally:
            mt5.shutdown()
