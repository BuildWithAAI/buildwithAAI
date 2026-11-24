"""Performance metrics. All computed from the engine's equity curve and
closed-trade list; nothing is estimated or annualised from assumptions other
than those documented here.

* CAGR: (end/start)^(365.25/calendar_days) - 1
* Sharpe / Sortino: daily (UTC) close-to-close equity returns, rf = 0,
  annualised by sqrt(observed trading days per year) (~260 for FX)
* Sortino downside deviation: sqrt(mean(min(r,0)^2))
* Max drawdown: on the bar-level equity curve
* Expectancy (R): mean of net PnL / initial risk per closed trade
"""

from __future__ import annotations

import math
from typing import Any, Iterable

import numpy as np
import pandas as pd

from ..execution.models import ClosedTrade


def _clean(x: float | None) -> float | None:
    if x is None:
        return None
    if isinstance(x, (float, np.floating)) and (math.isnan(x) or math.isinf(x)):
        return None
    return float(x)


def daily_returns(equity: pd.Series) -> pd.Series:
    d = equity.resample("1D").last().dropna()
    d = d[d.index.dayofweek < 5]
    return d.pct_change().dropna()


def compute_metrics(equity: pd.Series, trades: Iterable[ClosedTrade], starting_equity: float) -> dict[str, Any]:
    trades = list(trades)
    out: dict[str, Any] = {"trade_count": len(trades), "starting_equity": starting_equity}
    if equity.empty:
        return out
    end_eq = float(equity.iloc[-1])
    days = max((equity.index[-1] - equity.index[0]).total_seconds() / 86400.0, 1e-9)
    years = days / 365.25
    out["ending_equity"] = end_eq
    out["total_return_pct"] = 100.0 * (end_eq / starting_equity - 1)
    out["cagr_pct"] = 100.0 * ((end_eq / starting_equity) ** (1 / years) - 1) if end_eq > 0 and years > 0 else None
    out["period_days"] = days
    r = daily_returns(equity)
    ppy = len(r) / years if years > 0 else 260.0
    out["periods_per_year"] = ppy
    if len(r) > 2 and r.std(ddof=1) > 0:
        out["sharpe"] = float(r.mean() / r.std(ddof=1) * math.sqrt(ppy))
        dd = math.sqrt(float(np.mean(np.minimum(r.to_numpy(), 0.0) ** 2)))
        out["sortino"] = float(r.mean() / dd * math.sqrt(ppy)) if dd > 0 else None
        out["ann_vol_pct"] = float(100 * r.std(ddof=1) * math.sqrt(ppy))
    else:
        out["sharpe"] = out["sortino"] = out["ann_vol_pct"] = None
    peak = equity.cummax()
    dd_series = equity / peak - 1
    out["max_drawdown_pct"] = float(-100 * dd_series.min())
    # longest underwater stretch
    under = dd_series < 0
    longest, cur_start = pd.Timedelta(0), None
    for ts, u in under.items():
        if u and cur_start is None:
            cur_start = ts
        elif not u and cur_start is not None:
            longest = max(longest, ts - cur_start)
            cur_start = None
    if cur_start is not None:
        longest = max(longest, equity.index[-1] - cur_start)
    out["longest_drawdown_days"] = longest.total_seconds() / 86400.0
    if trades:
        pnl = np.array([t.net_pnl for t in trades], dtype=float)
        rs = np.array([t.r_multiple for t in trades])
        wins, losses = pnl[pnl > 0], pnl[pnl <= 0]
        out["win_rate_pct"] = 100.0 * len(wins) / len(trades)
        gw, gl = float(wins.sum()), float(-losses.sum())
        out["profit_factor"] = gw / gl if gl > 0 else None
        out["expectancy_r"] = float(rs.mean())
        out["avg_win_r"] = float(rs[pnl > 0].mean()) if len(wins) else None
        out["avg_loss_r"] = float(rs[pnl <= 0].mean()) if len(losses) else None
        out["best_trade_r"], out["worst_trade_r"] = float(rs.max()), float(rs.min())
        out["avg_bars_held"] = float(np.mean([t.bars_held for t in trades]))
        out["total_commission"] = float(sum(t.commission for t in trades))
        out["total_swap"] = float(sum(getattr(t, "swap", 0.0) for t in trades))
        out["net_pnl"] = float(pnl.sum())
        out["long_trades"] = int(sum(1 for t in trades if t.side > 0))
        out["short_trades"] = int(sum(1 for t in trades if t.side < 0))
        out["exit_kinds"] = {k: int(sum(1 for t in trades if t.exit_kind == k)) for k in sorted({t.exit_kind for t in trades})}
    else:
        for k in ("win_rate_pct", "profit_factor", "expectancy_r"):
            out[k] = None
    return {k: (_clean(v) if isinstance(v, float) else v) for k, v in out.items()}


def per_pair_metrics(trades: Iterable[ClosedTrade]) -> dict[str, dict[str, Any]]:
    by: dict[str, list[ClosedTrade]] = {}
    for t in trades:
        by.setdefault(t.pair, []).append(t)
    res = {}
    for pair, ts in sorted(by.items()):
        pnl = np.array([t.net_pnl for t in ts], dtype=float)
        rs = np.array([t.r_multiple for t in ts])
        loss = float(-pnl[pnl <= 0].sum())
        res[pair] = {"trades": len(ts), "win_rate_pct": float(100 * (pnl > 0).mean()),
                     "expectancy_r": float(rs.mean()), "net_pnl": float(pnl.sum()),
                     "profit_factor": _clean(float(pnl[pnl > 0].sum()) / loss) if loss > 0 else None}
    return res
