"""OHLCV normalisation and validation.

Rules (all bars are labelled by their OPEN time, in UTC):
* index -> tz-aware UTC, sorted, duplicates removed (last wins, counted)
* NaN / non-positive prices dropped (counted)
* OHLC consistency repaired (high=max(o,h,l,c), low=min(...)) and counted
* weekend bars removed: D1 Sat/Sun labels; intraday Saturday, Friday >= 22:00,
  Sunday < 20:00 UTC (lenient window to cover DST shifts)
* incomplete (still-forming) final bar removed using ``now``
* gaps detected (not filled) against the core FX week; holidays show as gaps
* spikes flagged (not removed) for human review
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any

import numpy as np
import pandas as pd

from .base import OHLCV_COLUMNS, Timeframe


@dataclass
class ValidationReport:
    pair: str
    timeframe: str
    rows_in: int = 0
    rows_out: int = 0
    duplicates_removed: int = 0
    nan_or_nonpositive_removed: int = 0
    ohlc_repaired: int = 0
    weekend_removed: int = 0
    incomplete_removed: int = 0
    missing_bars: int = 0
    largest_gaps: list[dict[str, Any]] = field(default_factory=list)
    spikes_flagged: list[str] = field(default_factory=list)
    first_bar: str | None = None
    last_bar: str | None = None
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def to_utc_index(idx: pd.Index) -> pd.DatetimeIndex:
    """Any index (naive => assumed UTC, tz-aware, or mixed-offset strings) -> UTC DatetimeIndex."""
    if isinstance(idx, pd.DatetimeIndex):
        di = idx.tz_localize("UTC") if idx.tz is None else idx.tz_convert("UTC")
    else:
        di = pd.DatetimeIndex(pd.to_datetime(idx, utc=True))
    return di.as_unit("ns")


def in_fx_session(ts: pd.DatetimeIndex, lenient: bool = True) -> np.ndarray:
    dow = ts.dayofweek.to_numpy()
    hour = ts.hour.to_numpy()
    fri_close, sun_open = (22, 20) if lenient else (21, 22)
    sat = dow == 5
    fri_late = (dow == 4) & (hour >= fri_close)
    sun_early = (dow == 6) & (hour < sun_open)
    return ~(sat | fri_late | sun_early)


def normalize_ohlcv(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    if isinstance(out.columns, pd.MultiIndex):
        out.columns = out.columns.get_level_values(0)
    out.columns = [str(c).strip().lower().replace(" ", "_") for c in out.columns]
    if "volume" not in out.columns:
        out["volume"] = 0.0
    missing = [c for c in OHLCV_COLUMNS if c not in out.columns]
    if missing:
        raise ValueError(f"missing columns {missing}")
    out = out[OHLCV_COLUMNS].astype("float64")
    out.index = to_utc_index(out.index)
    out.index.name = "ts"
    return out


def validate_ohlcv(
    df: pd.DataFrame,
    pair: str,
    timeframe: Timeframe,
    now: pd.Timestamp | None = None,
    max_gaps_listed: int = 5,
) -> tuple[pd.DataFrame, ValidationReport]:
    rep = ValidationReport(pair=pair, timeframe=timeframe.value, rows_in=len(df))
    if df.empty:
        rep.warnings.append("empty input")
        return df, rep
    out = normalize_ohlcv(df)

    # duplicates & order
    dup = out.index.duplicated(keep="last")
    rep.duplicates_removed = int(dup.sum())
    out = out[~dup].sort_index()

    # NaN / non-positive
    px = out[["open", "high", "low", "close"]]
    bad = px.isna().any(axis=1) | (px <= 0).any(axis=1)
    rep.nan_or_nonpositive_removed = int(bad.sum())
    out = out[~bad]

    # OHLC consistency
    hi = out[["open", "high", "low", "close"]].max(axis=1)
    lo = out[["open", "high", "low", "close"]].min(axis=1)
    needs = (out["high"] < hi - 1e-12) | (out["low"] > lo + 1e-12)
    rep.ohlc_repaired = int(needs.sum())
    out = out.assign(high=hi, low=lo)

    # weekend
    if timeframe is Timeframe.D1:
        out.index = out.index.normalize()
        wk = out.index.dayofweek >= 5
    else:
        wk = ~in_fx_session(out.index, lenient=True)
    rep.weekend_removed = int(np.sum(wk))
    out = out[~wk]

    # incomplete last bar(s)
    now = pd.Timestamp.now(tz="UTC") if now is None else pd.Timestamp(now).tz_convert("UTC")
    close_time = out.index + timeframe.delta
    inc = close_time > now
    rep.incomplete_removed = int(inc.sum())
    out = out[~inc]

    # gaps
    if len(out) > 1:
        if timeframe is Timeframe.D1:
            expected = pd.bdate_range(out.index[0], out.index[-1], tz="UTC")
        else:
            full = pd.date_range(out.index[0], out.index[-1], freq=f"{timeframe.minutes}min", tz="UTC")
            expected = full[in_fx_session(full, lenient=False)]
        missing = expected.difference(out.index)
        rep.missing_bars = int(len(missing))
        if len(missing):
            s = pd.Series(1, index=missing)
            step = timeframe.delta if timeframe.is_intraday else pd.Timedelta(days=1)
            grp = (s.index.to_series().diff() > step * (3 if timeframe is Timeframe.D1 else 1)).cumsum()
            runs = s.groupby(grp.values).apply(lambda x: (x.index[0], x.index[-1], len(x)))
            runs = sorted(runs.tolist(), key=lambda r: -r[2])[:max_gaps_listed]
            rep.largest_gaps = [{"start": a.isoformat(), "end": b.isoformat(), "missing": n} for a, b, n in runs]

        # spikes: |log return| > 12x rolling median absolute return (flag only)
        lr = np.log(out["close"]).diff().abs()
        med = lr.rolling(200, min_periods=20).median().shift(1)
        spk = lr[(lr > 12 * med) & (med > 0)]
        rep.spikes_flagged = [t.isoformat() for t in spk.index[:20]]
        if len(spk) > 20:
            rep.warnings.append(f"{len(spk)} spikes flagged; first 20 listed")

    if (out["volume"] == 0).all():
        rep.warnings.append("volume is all zero (no FX volume from this provider)")
    rep.rows_out = len(out)
    rep.first_bar = out.index[0].isoformat() if len(out) else None
    rep.last_bar = out.index[-1].isoformat() if len(out) else None
    return out, rep


def resample_ohlcv(df: pd.DataFrame, timeframe: Timeframe, src_tf: Timeframe) -> pd.DataFrame:
    """Aggregate to a higher timeframe (UTC-midnight aligned). Buckets whose
    source bars are less than 50% present are dropped to avoid fake candles."""
    rule = "1D" if timeframe is Timeframe.D1 else f"{timeframe.minutes}min"
    agg = df.resample(rule, label="left", closed="left").agg(
        {"open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"}
    )
    counts = df["close"].resample(rule, label="left", closed="left").count()
    expected = timeframe.minutes / src_tf.minutes
    agg = agg[(counts >= 0.5 * expected) & agg["close"].notna()]
    return agg
