"""Causal indicators: every value at row t depends only on rows <= t."""

from __future__ import annotations

import pandas as pd


def ema(s: pd.Series, n: int) -> pd.Series:
    return s.ewm(span=n, adjust=False, min_periods=n).mean()


def sma(s: pd.Series, n: int) -> pd.Series:
    return s.rolling(n, min_periods=n).mean()


def true_range(df: pd.DataFrame) -> pd.Series:
    prev_close = df["close"].shift(1)
    return pd.concat([df["high"] - df["low"], (df["high"] - prev_close).abs(), (df["low"] - prev_close).abs()],
                     axis=1).max(axis=1)


def atr(df: pd.DataFrame, n: int = 14) -> pd.Series:
    """Wilder ATR."""
    return true_range(df).ewm(alpha=1 / n, adjust=False, min_periods=n).mean()


def rolling_pct_rank(s: pd.Series, n: int) -> pd.Series:
    """Percentile rank of the current value within the trailing n-window (inclusive), in [0, 1]."""
    return s.rolling(n, min_periods=n).rank(pct=True)
