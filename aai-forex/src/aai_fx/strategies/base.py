"""Strategy interface.

Contract (enforced by tests/test_no_lookahead.py):
1. ``prepare(df)`` computes features using only causal operations: the value
   at row t may depend on rows <= t only. Truncating the input must not change
   any earlier feature value.
2. ``on_bar(ctx)`` is called at the CLOSE of bar ``ctx.i``. ``BarContext``
   refuses negative lags, so a strategy cannot read bar i+1.
3. Signals are executed by the engine at the OPEN of the next bar, never on
   the bar that generated them.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import asdict, dataclass, field
from enum import Enum
from typing import Any, Mapping

import numpy as np
import pandas as pd

from ..data.base import Timeframe


class LookaheadError(RuntimeError):
    pass


class SignalAction(str, Enum):
    ENTER_LONG = "ENTER_LONG"
    ENTER_SHORT = "ENTER_SHORT"
    EXIT = "EXIT"


@dataclass
class Signal:
    ts: pd.Timestamp  # close time of the bar that produced the signal
    pair: str
    strategy: str
    action: SignalAction
    ref_price: float  # close of signal bar (mid)
    stop: float | None = None
    target: float | None = None
    reason: str = ""
    meta: dict[str, Any] = field(default_factory=dict)

    @property
    def side(self) -> int:
        return {SignalAction.ENTER_LONG: 1, SignalAction.ENTER_SHORT: -1}.get(self.action, 0)

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["ts"] = self.ts.isoformat()
        d["action"] = self.action.value
        return d


@dataclass
class PositionView:
    side: int
    entry_price: float
    stop: float | None
    target: float | None
    entry_ts: pd.Timestamp
    bars_held: int


class BarContext:
    """Read-only, lag-only view of features at bar ``i``."""

    __slots__ = ("pair", "i", "ts", "close_ts", "_cols", "position")

    def __init__(self, pair: str, i: int, index: pd.DatetimeIndex, cols: Mapping[str, np.ndarray],
                 tf_delta: pd.Timedelta, position: PositionView | None) -> None:
        self.pair = pair
        self.i = i
        self.ts = index[i]
        self.close_ts = index[i] + tf_delta
        self._cols = cols
        self.position = position

    def get(self, col: str, lag: int = 0) -> float:
        if lag < 0:
            raise LookaheadError(f"negative lag {lag} on {col} would read the future")
        j = self.i - lag
        if j < 0:
            return float("nan")
        return float(self._cols[col][j])


class Strategy(ABC):
    name: str = "abstract"

    def __init__(self, timeframe: str | Timeframe, **params: Any) -> None:
        self.timeframe = Timeframe.parse(timeframe)
        self.params = params
        self.reset()

    def reset(self) -> None:
        """Clear per-run state (called by the engine before every run)."""

    @property
    def warmup_bars(self) -> int:
        return 50

    @abstractmethod
    def prepare(self, df: pd.DataFrame, pair: str) -> pd.DataFrame:
        """Return df plus causal feature columns."""

    @abstractmethod
    def on_bar(self, ctx: BarContext) -> list[Signal]:
        """Decide at the close of bar ctx.i."""

    def describe(self) -> dict[str, Any]:
        return {"name": self.name, "timeframe": self.timeframe.value, "params": self.params}
