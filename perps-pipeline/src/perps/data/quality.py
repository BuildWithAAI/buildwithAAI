"""Data-quality checks for OHLCV and funding series."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field

import numpy as np
import pandas as pd

from ..timeframes import ms as tf_ms


@dataclass
class Gap:
    start: str
    end: str
    missing_bars: int


@dataclass
class QualityReport:
    symbol: str
    timeframe: str
    rows: int
    first: str | None
    last: str | None
    expected_rows: int
    coverage: float
    duplicates: int
    gaps: list[Gap] = field(default_factory=list)
    ohlc_violations: int = 0
    non_positive_prices: int = 0
    zero_volume_bars: int = 0
    return_outliers: int = 0
    max_abs_return: float = 0.0
    passed: bool = True
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["gaps"] = [asdict(g) for g in self.gaps][:50]
        d["gap_count"] = len(self.gaps)
        d["missing_bars_total"] = int(sum(g.missing_bars for g in self.gaps))
        return d


def find_gaps(ts: pd.Series, timeframe: str) -> list[Gap]:
    step = tf_ms(timeframe)
    if len(ts) < 2:
        return []
    arr = np.sort(ts.astype("int64").to_numpy())
    diffs = np.diff(arr)
    gaps = []
    for i in np.where(diffs > step)[0]:
        gaps.append(Gap(
            start=str(pd.to_datetime(arr[i] + step, unit="ms", utc=True)),
            end=str(pd.to_datetime(arr[i + 1], unit="ms", utc=True)),
            missing_bars=int(diffs[i] // step - 1),
        ))
    return gaps


def check_ohlcv(df: pd.DataFrame, symbol: str, timeframe: str, outlier_sigma: float = 12.0,
                max_missing_frac: float = 0.01) -> QualityReport:
    if df.empty:
        return QualityReport(symbol, timeframe, 0, None, None, 0, 0.0, 0, passed=False, notes=["empty"])
    ts = df["ts"].astype("int64")
    step = tf_ms(timeframe)
    expected = int((ts.max() - ts.min()) // step + 1)
    dups = int(ts.duplicated().sum())
    gaps = find_gaps(ts.drop_duplicates(), timeframe)
    o, h, l, c = (df[k].astype(float) for k in ("open", "high", "low", "close"))
    viol = int(((h < np.maximum(o, c) - 1e-12) | (l > np.minimum(o, c) + 1e-12) | (h < l)).sum())
    nonpos = int(((o <= 0) | (h <= 0) | (l <= 0) | (c <= 0)).sum())
    zero_vol = int((df["volume"].astype(float) <= 0).sum())
    rets = np.log(c).diff().dropna()
    mad = float(np.median(np.abs(rets - rets.median()))) * 1.4826 if len(rets) else 0.0
    outliers = int((np.abs(rets - rets.median()) > outlier_sigma * mad).sum()) if mad > 0 else 0
    rep = QualityReport(
        symbol=symbol, timeframe=timeframe, rows=len(df),
        first=str(pd.to_datetime(ts.min(), unit="ms", utc=True)),
        last=str(pd.to_datetime(ts.max(), unit="ms", utc=True)),
        expected_rows=expected, coverage=round(len(ts.drop_duplicates()) / expected, 6) if expected else 0.0,
        duplicates=dups, gaps=gaps, ohlc_violations=viol, non_positive_prices=nonpos,
        zero_volume_bars=zero_vol, return_outliers=outliers,
        max_abs_return=float(np.abs(rets).max()) if len(rets) else 0.0,
    )
    missing = sum(g.missing_bars for g in gaps)
    if dups:
        rep.notes.append(f"{dups} duplicate timestamps")
    if viol or nonpos:
        rep.passed = False
        rep.notes.append(f"{viol} OHLC violations, {nonpos} non-positive prices")
    if expected and missing / expected > max_missing_frac:
        rep.passed = False
        rep.notes.append(f"missing {missing} bars ({missing / expected:.2%}) > {max_missing_frac:.0%}")
    elif missing:
        rep.notes.append(f"{len(gaps)} gaps / {missing} missing bars (within tolerance)")
    if outliers:
        rep.notes.append(f"{outliers} return outliers > {outlier_sigma} robust sigma (inspect, not removed)")
    return rep


def check_funding(df: pd.DataFrame, interval_hours: float = 8.0) -> dict:
    if df.empty:
        return {"rows": 0, "passed": False, "notes": ["empty"]}
    ts = df["ts"].astype("int64").sort_values()
    diffs = ts.diff().dropna() / 3_600_000
    irregular = int((np.abs(diffs - interval_hours) > 0.01).sum())
    return {
        "rows": int(len(df)),
        "first": str(pd.to_datetime(ts.min(), unit="ms", utc=True)),
        "last": str(pd.to_datetime(ts.max(), unit="ms", utc=True)),
        "interval_hours_mode": float(diffs.mode().iloc[0]) if len(diffs) else None,
        "irregular_intervals": irregular,
        "mean_rate": float(df["funding_rate"].mean()),
        "max_abs_rate": float(df["funding_rate"].abs().max()),
        "passed": True,
        "notes": [f"{irregular} intervals differ from {interval_hours}h"] if irregular else [],
    }
