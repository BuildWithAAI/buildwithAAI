"""Performance metrics. Every number is computed from the trade list / equity curve passed in."""
from __future__ import annotations

import math

import numpy as np
import pandas as pd


def daily_equity(equity: pd.Series) -> pd.Series:
    if equity.empty:
        return equity
    return equity.resample("1D").last().dropna()


def max_drawdown_pct(equity: pd.Series) -> float:
    if equity.empty:
        return 0.0
    peak = equity.cummax()
    return float(((equity - peak) / peak).min() * 100)


def sharpe_sortino(daily: pd.Series, periods: int = 365) -> tuple[float | None, float | None]:
    r = daily.pct_change().dropna()
    if len(r) < 5 or r.std() == 0:
        return None, None
    sharpe = float(r.mean() / r.std() * math.sqrt(periods))
    downside = r[r < 0]
    dd = math.sqrt((downside ** 2).sum() / len(r)) if len(downside) else 0.0
    sortino = float(r.mean() / dd * math.sqrt(periods)) if dd > 0 else None
    return sharpe, sortino


def trade_stats(df: pd.DataFrame) -> dict:
    n = int(len(df))
    if n == 0:
        return {"trades": 0, "win_rate_pct": None, "avg_r": None, "expectancy_usd": None,
                "profit_factor": None, "total_pnl_usd": 0.0, "avg_hold_h": None}
    wins = df[df.pnl_usd > 0]
    losses = df[df.pnl_usd <= 0]
    gl = -losses.pnl_usd.sum()
    hold = (pd.to_datetime(df.exit_ts) - pd.to_datetime(df.entry_ts)).dt.total_seconds() / 3600
    return {
        "trades": n,
        "win_rate_pct": round(len(wins) / n * 100, 1),
        "avg_r": round(float(df.r_multiple.mean()), 3),
        "median_r": round(float(df.r_multiple.median()), 3),
        "avg_r_ex_fees": round(float(((df.pnl_usd + df.fees_usd) / df.risk_usd).mean()), 3)
        if "risk_usd" in df else None,
        "expectancy_usd": round(float(df.pnl_usd.mean()), 2),
        "profit_factor": round(float(wins.pnl_usd.sum() / gl), 2) if gl > 0 else None,
        "total_pnl_usd": round(float(df.pnl_usd.sum()), 2),
        "fees_usd": round(float(df.fees_usd.sum()), 2),
        "avg_hold_h": round(float(hold.mean()), 1),
    }


def summarize(trades: pd.DataFrame, equity: pd.Series, start_equity: float) -> dict:
    daily = daily_equity(equity)
    sh, so = sharpe_sortino(daily)
    out = trade_stats(trades)
    end_eq = float(equity.iloc[-1]) if not equity.empty else start_equity
    out.update({
        "start": str(equity.index[0]) if not equity.empty else None,
        "end": str(equity.index[-1]) if not equity.empty else None,
        "start_equity": start_equity,
        "end_equity": round(end_eq, 2),
        "return_pct": round((end_eq / start_equity - 1) * 100, 2),
        "max_dd_pct": round(max_drawdown_pct(equity), 2),
        "sharpe": None if sh is None else round(sh, 2),
        "sortino": None if so is None else round(so, 2),
    })
    return out


def breakdown(trades: pd.DataFrame, by: str) -> dict[str, dict]:
    if trades.empty:
        return {}
    return {str(k): trade_stats(g) for k, g in trades.groupby(by)}


def buy_and_hold(closes: dict[str, pd.Series], start, end, start_equity: float) -> dict[str, dict]:
    """Buy-and-hold over the same window: each asset alone and an equal-weight basket (no rebalancing)."""
    out = {}
    curves = {}
    for a, s in closes.items():
        w = s[(s.index >= start) & (s.index <= end)].dropna()
        if len(w) < 2:
            continue
        curve = start_equity * w / w.iloc[0]
        curves[a] = curve
        d = daily_equity(curve)
        sh, _ = sharpe_sortino(d)
        out[a] = {"return_pct": round((w.iloc[-1] / w.iloc[0] - 1) * 100, 2),
                  "max_dd_pct": round(max_drawdown_pct(curve), 2),
                  "sharpe": None if sh is None else round(sh, 2)}
    if curves:
        basket = pd.DataFrame(curves).dropna().mean(axis=1)
        d = daily_equity(basket)
        sh, _ = sharpe_sortino(d)
        out["EW_basket"] = {"return_pct": round((basket.iloc[-1] / basket.iloc[0] - 1) * 100, 2),
                            "max_dd_pct": round(max_drawdown_pct(basket), 2),
                            "sharpe": None if sh is None else round(sh, 2)}
        out["_basket_curve"] = basket  # type: ignore[assignment]
    return out


def spearman(a: list[float], b: list[float]) -> float | None:
    if len(a) < 3:
        return None
    ra, rb = pd.Series(a).rank(), pd.Series(b).rank()
    if ra.std() == 0 or rb.std() == 0:
        return None
    return float(np.corrcoef(ra, rb)[0, 1])
