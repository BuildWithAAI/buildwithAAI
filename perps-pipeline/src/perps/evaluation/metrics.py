"""Performance metrics. Sharpe/Sortino use DAILY returns of the mark-to-market equity curve
(annualised with sqrt(365), crypto trades every day), so values are comparable across timeframes."""

from __future__ import annotations

import math

import numpy as np
import pandas as pd

from ..backtest.engine import BacktestResult


def max_drawdown(equity: pd.Series) -> float:
    if equity.empty:
        return 0.0
    peak = equity.cummax()
    return float((equity / peak - 1).min())


def compute_metrics(res: BacktestResult) -> dict:
    eq, tr = res.equity, res.trades
    out: dict = {"start": None, "end": None, "days": 0.0, "trades": int(len(tr))}
    if eq.empty:
        return out
    eq0 = res.initial_equity
    final = float(eq.iloc[-1])
    days = (eq.index[-1] - eq.index[0]).total_seconds() / 86400
    daily = pd.concat([pd.Series([eq0], index=[eq.index[0] - pd.Timedelta(seconds=1)]), eq]).resample("1D").last().ffill()
    dr = daily.pct_change().dropna()
    sd = dr.std(ddof=1)
    downside = np.sqrt(np.mean(np.minimum(dr, 0) ** 2)) if len(dr) else 0.0
    net_ret = final / eq0 - 1
    out.update({
        "start": str(eq.index[0]), "end": str(eq.index[-1]), "days": round(days, 1),
        "initial_equity": eq0, "final_equity": round(final, 4), "net_return": net_ret,
        "cagr": (final / eq0) ** (365 / days) - 1 if days >= 90 and final > 0 else None,
        "sharpe": float(dr.mean() / sd * math.sqrt(365)) if sd and sd > 0 else 0.0,
        "sortino": float(dr.mean() / downside * math.sqrt(365)) if downside > 0 else 0.0,
        "max_drawdown": max_drawdown(eq),
        "exposure": float(res.exposure.mean()) if len(res.exposure) else 0.0,
    })
    if len(tr):
        wins, losses = tr[tr["net_pnl"] > 0], tr[tr["net_pnl"] <= 0]
        gp, gl = wins["net_pnl"].sum(), -losses["net_pnl"].sum()
        out.update({
            "win_rate": len(wins) / len(tr),
            "profit_factor": float(gp / gl) if gl > 0 else float("inf") if gp > 0 else 0.0,
            "expectancy_r": float(tr["r_multiple"].mean()),
            "avg_win_r": float(wins["r_multiple"].mean()) if len(wins) else 0.0,
            "avg_loss_r": float(losses["r_multiple"].mean()) if len(losses) else 0.0,
            "total_fees": float(tr["fees"].sum()), "total_funding": float(tr["funding"].sum()),
            "gross_pnl": float(tr["gross_pnl"].sum()), "net_pnl": float(tr["net_pnl"].sum()),
            "avg_bars_held": float(tr["bars_held"].mean()),
            "avg_implied_leverage": float(tr["implied_leverage"].mean()),
            "max_implied_leverage": float(tr["implied_leverage"].max()),
            "avg_notional": float(tr["notional"].mean()),
            "long_trades": int((tr["side"] == "long").sum()), "short_trades": int((tr["side"] == "short").sum()),
            "exit_reasons": tr["exit_reason"].value_counts().to_dict(),
            "liquidations": int((tr["exit_reason"] == "liquidation").sum()),
        })
    out["rejections"] = res.rejections
    out["kill_reason"] = res.kill_reason
    return out


SUMMARY_KEYS = ["trades", "net_return", "cagr", "sharpe", "sortino", "max_drawdown", "win_rate", "profit_factor",
                "expectancy_r", "exposure", "total_fees", "total_funding"]
