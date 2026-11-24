"""Pluggable strategy interface.

Contract (enforced by tests/test_no_lookahead.py):
  * `compute(df)` returns a frame aligned to df.index with columns
        signal    int   +1 enter long / -1 enter short / 0 nothing   (decided at bar CLOSE)
        stop_dist float distance from fill price to initial stop (price units), or NaN
        stop_price float optional absolute stop (takes precedence when not NaN)
        atr       float ATR at bar close (used for trailing stops)
        exit_long / exit_short bool   discretionary exit signals (decided at bar close)
  * Row t may use only information available at the close of bar t. The engine executes any
    resulting order at the OPEN of bar t+1, never at bar t's close.
"""

from __future__ import annotations

import abc
from dataclasses import dataclass
from typing import Any, ClassVar

import numpy as np
import pandas as pd


@dataclass(frozen=True)
class ExitParams:
    take_profit_r: float = 2.0      # 0 disables TP
    trail_atr_mult: float = 0.0     # 0 disables trailing stop
    max_hold_bars: int = 0          # 0 disables time stop


class Strategy(abc.ABC):
    name: ClassVar[str] = "base"
    style: ClassVar[str] = ""
    defaults: ClassVar[dict[str, Any]] = {}

    def __init__(self, timeframe: str, params: dict[str, Any] | None = None) -> None:
        self.timeframe = timeframe
        unknown = set(params or {}) - set(self.defaults)
        if unknown:
            raise ValueError(f"{self.name}: unknown params {sorted(unknown)}")
        self.params: dict[str, Any] = {**self.defaults, **(params or {})}

    @property
    def exit_params(self) -> ExitParams:
        p = self.params
        return ExitParams(float(p.get("take_profit_r", 0) or 0), float(p.get("trail_atr_mult", 0) or 0),
                          int(p.get("max_hold_bars", 0) or 0))

    @property
    @abc.abstractmethod
    def warmup_bars(self) -> int: ...

    @abc.abstractmethod
    def _signals(self, df: pd.DataFrame) -> pd.DataFrame: ...

    def compute(self, df: pd.DataFrame) -> pd.DataFrame:
        out = self._signals(df)
        for col, default in (("signal", 0), ("stop_dist", np.nan), ("stop_price", np.nan), ("atr", np.nan),
                             ("exit_long", False), ("exit_short", False)):
            if col not in out:
                out[col] = default
        out["signal"] = out["signal"].fillna(0).astype(int)
        if not self.params.get("allow_short", True):
            out.loc[out["signal"] < 0, "signal"] = 0
        # no signals during warm-up or where the stop is undefined
        warm = np.arange(len(out)) < self.warmup_bars
        bad_stop = out["stop_dist"].isna() & out["stop_price"].isna()
        out.loc[warm | bad_stop.to_numpy(), "signal"] = 0
        out["exit_long"] = out["exit_long"].fillna(False).astype(bool)
        out["exit_short"] = out["exit_short"].fillna(False).astype(bool)
        return out[["signal", "stop_dist", "stop_price", "atr", "exit_long", "exit_short"]]

    def describe(self) -> str:
        return f"{self.name}[{self.timeframe}] " + ", ".join(f"{k}={v}" for k, v in sorted(self.params.items()))
