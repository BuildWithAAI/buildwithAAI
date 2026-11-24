"""Shared causal bar features and explicit signal arrays (no execution API)."""
from __future__ import annotations
from dataclasses import dataclass, field
import numpy as np
import pandas as pd


def add_bidask(mid: pd.DataFrame, spread: pd.Series) -> pd.DataFrame:
    out = mid.copy()
    half = spread / 2
    for c in ("open", "high", "low", "close"):
        out[f"bid_{c}"] = mid[c] - half
        out[f"ask_{c}"] = mid[c] + half
    return out


def prepare_bidask(df: pd.DataFrame, spread_pips: float | None = None) -> pd.DataFrame:
    out = df.copy()
    if "bid_open" not in out:
        sp = spread_pips if spread_pips is not None else out.spread_open.median() / 0.0001
        out = add_bidask(out, pd.Series(sp * 0.0001, index=out.index))
    elif "spread_open" in out:
        half = out.spread_open / 2
        for c in ("open", "high", "low", "close"):
            if f"bid_{c}" not in out:
                out[f"bid_{c}"] = out[c] - half
            if f"ask_{c}" not in out:
                out[f"ask_{c}"] = out[c] + half
    out["spread_pips"] = (out.ask_open - out.bid_open) / 0.0001
    return out


def regime(close: pd.Series, fast_n: int = 200, slow_n: int = 800) -> pd.Series:
    fast = close.ewm(span=fast_n, adjust=False).mean()
    slow = close.ewm(span=slow_n, adjust=False).mean()
    return pd.Series(np.where((close > slow) & (fast > slow), 1,
                      np.where((close < slow) & (fast < slow), -1, 0)), index=close.index)


@dataclass
class Signals:
    side: np.ndarray
    stop_pips: np.ndarray
    target_r: np.ndarray
    trail_pips: np.ndarray
    eod: np.ndarray
    regime_exit: np.ndarray = field(default_factory=lambda: np.zeros(0, dtype=np.int64))
    max_bars: int = 0
    metadata: dict = field(default_factory=dict)

    @classmethod
    def blank(cls, n: int) -> "Signals":
        return cls(np.zeros(n, dtype=np.int64), np.zeros(n), np.full(n, np.nan),
                   np.full(n, np.nan), np.zeros(n, dtype=np.int64), np.zeros(n, dtype=np.int64))
