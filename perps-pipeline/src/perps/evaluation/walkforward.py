"""In-sample / out-of-sample split, anchored walk-forward optimisation and parameter sweeps.

Rules that keep OOS honest:
  * Parameters are selected using IS data only (objective computed on IS trades/equity).
  * OOS runs see pre-OOS bars only as indicator warm-up; no trades are opened before the split.
  * The full OOS grid is ALSO reported (robustness view), clearly labelled as not used for selection.
"""

from __future__ import annotations

import itertools
import logging
from dataclasses import dataclass

import pandas as pd

from ..backtest.engine import BacktestEngine, BacktestResult, SymbolData
from ..config import Settings
from ..strategies import build_strategy
from .metrics import compute_metrics

log = logging.getLogger(__name__)


def split_time(data: list[SymbolData], is_fraction: float) -> pd.Timestamp:
    starts = max(d.bars.index[0] for d in data)
    ends = min(d.bars.index[-1] for d in data)
    return starts + (ends - starts) * is_fraction


def objective(m: dict, min_trades: int = 20) -> float:
    """IS selection objective: daily Sharpe, heavily penalised if too few trades."""
    if m.get("trades", 0) < min_trades:
        return -99.0
    return float(m.get("sharpe", 0.0))


def grid(sweep: dict[str, list]) -> list[dict]:
    if not sweep:
        return [{}]
    keys = sorted(sweep)
    return [dict(zip(keys, vals, strict=True)) for vals in itertools.product(*(sweep[k] for k in keys))]


@dataclass
class SplitRun:
    params: dict
    is_metrics: dict
    oos_metrics: dict
    is_result: BacktestResult
    oos_result: BacktestResult


def run_split(settings: Settings, name: str, timeframe: str, params: dict, data: list[SymbolData],
              split: pd.Timestamp, exchange: str) -> SplitRun:
    eng = BacktestEngine(settings, exchange)
    strat = build_strategy(name, timeframe, params)
    is_res = eng.run(strat, data, trade_end=split)
    oos_res = eng.run(strat, data, trade_start=split)
    return SplitRun(params, compute_metrics(is_res), compute_metrics(oos_res), is_res, oos_res)


def sweep(settings: Settings, name: str, timeframe: str, base_params: dict, sweep_space: dict,
          data: list[SymbolData], split: pd.Timestamp, exchange: str, min_trades: int = 20) -> pd.DataFrame:
    rows = []
    for combo in grid(sweep_space):
        params = {**base_params, **combo}
        r = run_split(settings, name, timeframe, params, data, split, exchange)
        rows.append({**{f"p_{k}": v for k, v in combo.items()},
                     **{f"is_{k}": r.is_metrics.get(k) for k in ("trades", "net_return", "sharpe", "max_drawdown",
                                                                 "expectancy_r", "profit_factor")},
                     **{f"oos_{k}": r.oos_metrics.get(k) for k in ("trades", "net_return", "sharpe", "max_drawdown",
                                                                   "expectancy_r", "profit_factor")},
                     "is_objective": objective(r.is_metrics, min_trades)})
    return pd.DataFrame(rows)


def walk_forward(settings: Settings, name: str, timeframe: str, base_params: dict, sweep_space: dict,
                 data: list[SymbolData], folds: int, exchange: str, min_trades: int = 10) -> dict:
    """Anchored walk-forward: the history is cut into folds+1 chunks; for fold k, optimise on
    chunks[0..k] and trade chunk k+1 with the selected params. OOS trades are concatenated."""
    start = max(d.bars.index[0] for d in data)
    end = min(d.bars.index[-1] for d in data)
    edges = [start + (end - start) * i / (folds + 1) for i in range(folds + 2)]
    eng = BacktestEngine(settings, exchange)
    combos = grid(sweep_space)
    fold_rows, oos_trades = [], []
    for k in range(1, folds + 1):
        train_end, test_end = edges[k], edges[k + 1]
        best, best_obj = base_params, -1e9
        for combo in combos:
            params = {**base_params, **combo}
            m = compute_metrics(eng.run(build_strategy(name, timeframe, params), data, trade_end=train_end))
            obj = objective(m, min_trades)
            if obj > best_obj:
                best, best_obj = params, obj
        test = eng.run(build_strategy(name, timeframe, best), data, trade_start=train_end, trade_end=test_end)
        tm = compute_metrics(test)
        fold_rows.append({"fold": k, "train_end": str(train_end), "test_end": str(test_end),
                          "is_objective": best_obj, "params": {k2: best[k2] for k2 in sweep_space},
                          "oos_trades": tm.get("trades", 0), "oos_net_return": tm.get("net_return"),
                          "oos_sharpe": tm.get("sharpe"), "oos_max_dd": tm.get("max_drawdown"),
                          "oos_expectancy_r": tm.get("expectancy_r")})
        if len(test.trades):
            oos_trades.append(test.trades.assign(fold=k))
    trades = pd.concat(oos_trades, ignore_index=True) if oos_trades else pd.DataFrame()
    summary = {"folds": fold_rows, "oos_trades": int(len(trades))}
    if len(trades):
        summary["oos_expectancy_r"] = float(trades["r_multiple"].mean())
        summary["oos_win_rate"] = float((trades["net_pnl"] > 0).mean())
        summary["oos_net_pnl"] = float(trades["net_pnl"].sum())
        # compounded product of fold returns (each fold restarts from initial equity)
        rets = [r["oos_net_return"] or 0.0 for r in fold_rows]
        comp = 1.0
        for r in rets:
            comp *= 1 + r
        summary["oos_compounded_return"] = comp - 1
    return summary
