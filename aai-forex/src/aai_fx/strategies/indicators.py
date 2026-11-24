"""Causal indicators (value at t uses data <= t only)."""

from __future__ import annotations

import pandas as pd

from ..data.base import Timeframe


def ema(s: pd.Series, n: int) -> pd.Series:
    return s.ewm(span=n, adjust=False, min_periods=n).mean()


def true_range(df: pd.DataFrame) -> pd.Series:
    pc = df["close"].shift(1)
    return pd.concat([df["high"] - df["low"], (df["high"] - pc).abs(), (df["low"] - pc).abs()], axis=1).max(axis=1)


def atr(df: pd.DataFrame, n: int = 14) -> pd.Series:
    """Wilder ATR."""
    return true_range(df).ewm(alpha=1.0 / n, adjust=False, min_periods=n).mean()


def donchian_prior(df: pd.DataFrame, n: int) -> tuple[pd.Series, pd.Series]:
    """Highest high / lowest low of the n bars BEFORE the current bar."""
    return df["high"].rolling(n).max().shift(1), df["low"].rolling(n).min().shift(1)


def daily_bars(df: pd.DataFrame, tf: Timeframe) -> pd.DataFrame:
    """Daily OHLC from operating bars, weekend buckets dropped. Index = day open (UTC midnight)."""
    if tf is Timeframe.D1:
        return df[["open", "high", "low", "close"]]
    d = df.resample("1D").agg({"open": "first", "high": "max", "low": "min", "close": "last"}).dropna()
    return d[d.index.dayofweek < 5]


def align_htf(htf: pd.DataFrame, htf_delta: pd.Timedelta, ltf_index: pd.DatetimeIndex,
              ltf_delta: pd.Timedelta) -> pd.DataFrame:
    """Map higher-timeframe features onto lower-timeframe bars WITHOUT lookahead.

    An HTF bar is visible at an LTF bar only if the HTF bar's close time is
    <= the LTF bar's close time (i.e. it had completed when we decide).
    """
    h = htf.copy()
    h["_htf_close"] = h.index + htf_delta
    left = pd.DataFrame({"_ltf_close": ltf_index + ltf_delta}, index=ltf_index)
    merged = pd.merge_asof(left.sort_values("_ltf_close"), h.sort_values("_htf_close"),
                           left_on="_ltf_close", right_on="_htf_close", direction="backward")
    merged.index = ltf_index
    return merged.drop(columns=["_ltf_close", "_htf_close"])
