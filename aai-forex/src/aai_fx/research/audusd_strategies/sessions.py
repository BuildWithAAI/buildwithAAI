"""DST-aware anchor times, always derived from data timestamp, never local wall clock."""
from __future__ import annotations
import pandas as pd


def ny_session(index: pd.DatetimeIndex) -> pd.DatetimeIndex:
    server = index.tz_convert("America/New_York") + pd.Timedelta(hours=7)
    return pd.DatetimeIndex(server.date).tz_localize("UTC")


def session_features(df: pd.DataFrame) -> pd.DataFrame:
    idx = df.index
    ny = idx.tz_convert("America/New_York")
    london = idx.tz_convert("Europe/London")
    sydney = idx.tz_convert("Australia/Sydney")
    ct = idx.tz_convert("America/Chicago")
    return pd.DataFrame({"session": ((idx.tz_convert("America/New_York") + pd.Timedelta(hours=7)).date),
                         "ny_hour": ny.hour + ny.minute / 60, "london_hour": london.hour + london.minute / 60,
                         "sydney_hour": sydney.hour + sydney.minute / 60,
                         "ct_hour": ct.hour + ct.minute / 60}, index=idx)


def regime_htf(df: pd.DataFrame, tf: str, fast: int = 200, slow: int = 800) -> pd.DataFrame:
    """Use long H1 history, completed NY+7 buckets and strict EMA seed warmup.

    Availability equals true bucket close, never its open label. Only complete
    H1 bars before the decision timestamp are mapped into an intraday signal.
    """
    import numpy as np
    from pathlib import Path
    from functools import lru_cache
    from ..audusd_features import load_higher_features
    feat = load_higher_features(tf,fast,slow)
    return feat.reindex(df.index, method="ffill")
