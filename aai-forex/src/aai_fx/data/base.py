"""Provider interface and timeframe definitions."""

from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime
from enum import Enum

import pandas as pd

OHLCV_COLUMNS = ["open", "high", "low", "close", "volume"]


class ProviderError(RuntimeError):
    pass


class Timeframe(str, Enum):
    M1 = "M1"
    M5 = "M5"
    M15 = "M15"
    M30 = "M30"
    H1 = "H1"
    H4 = "H4"
    D1 = "D1"

    @property
    def minutes(self) -> int:
        return {"M1": 1, "M5": 5, "M15": 15, "M30": 30, "H1": 60, "H4": 240, "D1": 1440}[self.value]

    @property
    def delta(self) -> pd.Timedelta:
        return pd.Timedelta(minutes=self.minutes)

    @property
    def is_intraday(self) -> bool:
        return self is not Timeframe.D1

    @property
    def bars_per_year(self) -> float:
        # ~260 trading days * 24h for intraday FX
        return 260.0 if self is Timeframe.D1 else 260.0 * 24 * 60 / self.minutes

    @classmethod
    def parse(cls, s: str | "Timeframe") -> "Timeframe":
        if isinstance(s, Timeframe):
            return s
        aliases = {"1M": "M1", "5M": "M5", "15M": "M15", "30M": "M30", "1H": "H1", "4H": "H4", "1D": "D1", "D": "D1"}
        u = s.upper()
        return cls(aliases.get(u, u))


class DataProvider(ABC):
    """Fetches OHLCV bars. Implementations must return a DataFrame with a
    UTC tz-aware DatetimeIndex (bar *open* time) and columns OHLCV_COLUMNS.
    Validation/normalisation is applied downstream by ``validate_ohlcv``."""

    name: str = "abstract"

    @abstractmethod
    def fetch(self, pair: str, timeframe: Timeframe, start: datetime | None, end: datetime | None) -> pd.DataFrame: ...

    def supported_timeframes(self) -> list[Timeframe]:
        return list(Timeframe)
