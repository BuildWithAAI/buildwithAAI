"""In-sample / out-of-sample split and rolling walk-forward optimisation.

Walk-forward: on each window, grid-search parameters on the TRAIN segment
(objective from config, min trade count enforced), then run the chosen
parameters on the following TEST segment only. Test segments never overlap
and are never used for selection. OOS results are stitched by compounding
each test segment's equity returns; trades are pooled.

Indicator warm-up for a test segment uses data BEFORE the segment (causal),
and data AFTER the segment end is cut off before features are computed.
"""

from __future__ import annotations

import itertools
from dataclasses import dataclass, field
from typing import Any

import numpy as np
import pandas as pd

from ..config import AppConfig, WalkForwardConfig
from ..strategies import strategy_from_config
from .engine import BacktestEngine, BacktestResult
from .metrics import compute_metrics, per_pair_metrics


@dataclass
class WFWindow:
    train_start: pd.Timestamp
    train_end: pd.Timestamp
    test_start: pd.Timestamp
    test_end: pd.Timestamp
    best_params: dict[str, Any]
    train_objective: float | None
    test_metrics: dict[str, Any]


@dataclass
class WalkForwardResult:
    windows: list[WFWindow]
    oos_metrics: dict[str, Any]
    oos_per_pair: dict[str, Any]
    oos_equity: pd.Series
    grid_size: int
    notes: list[str] = field(default_factory=list)


def is_oos_split(cfg: AppConfig, strategy_name: str, data: dict[str, pd.DataFrame],
                 oos_fraction: float | None = None, kill: bool = True) -> tuple[pd.Timestamp, BacktestResult, BacktestResult]:
    sc = cfg.strategies[strategy_name]
    frac = oos_fraction if oos_fraction is not None else cfg.backtest.oos_fraction
    timeline = sorted(set().union(*[set(df.index) for df in data.values()]))
    split = timeline[int(len(timeline) * (1 - frac))]
    eng_is = BacktestEngine(cfg, strategy_from_config(strategy_name, cfg), enforce_drawdown_kill=kill)
    r_is = eng_is.run(data, end=split)
    eng_oos = BacktestEngine(cfg, strategy_from_config(strategy_name, cfg), enforce_drawdown_kill=kill)
    r_oos = eng_oos.run(data, start=split)
    return split, r_is, r_oos


def _objective(m: dict[str, Any], name: str, min_trades: int) -> float | None:
    if (m.get("trade_count") or 0) < min_trades:
        return None
    v = m.get(name)
    return None if v is None else float(v)


def walk_forward(cfg: AppConfig, strategy_name: str, data: dict[str, pd.DataFrame],
                 wf: WalkForwardConfig | None = None, min_trades: int = 10,
                 kill: bool = True) -> WalkForwardResult:
    sc = cfg.strategies[strategy_name]
    wf = wf or cfg.backtest.walkforward.get(strategy_name) or WalkForwardConfig()
    timeline = sorted(set().union(*[set(df.index) for df in data.values()]))
    keys = sorted(wf.grid)
    combos = [dict(zip(keys, vals)) for vals in itertools.product(*[wf.grid[k] for k in keys])] or [{}]
    windows: list[WFWindow] = []
    oos_rets: list[pd.Series] = []
    oos_trades = []
    notes: list[str] = []
    s = 0
    while s + wf.train_bars + wf.test_bars <= len(timeline):
        tr0, tr1 = timeline[s], timeline[s + wf.train_bars]
        te0 = tr1
        te1_i = min(s + wf.train_bars + wf.test_bars, len(timeline) - 1)
        te1 = timeline[te1_i]
        best, best_val = None, None
        for combo in combos:
            params = {**sc.params, **combo}
            r = BacktestEngine(cfg, strategy_from_config(strategy_name, cfg, params), enforce_drawdown_kill=kill).run(data, start=tr0, end=tr1)
            v = _objective(r.metrics, wf.objective, min_trades)
            if v is not None and (best_val is None or v > best_val):
                best, best_val = params, v
        if best is None:
            best = dict(sc.params)
            notes.append(f"window {tr0.date()}..{tr1.date()}: no combo met min_trades={min_trades}; used defaults")
        rt = BacktestEngine(cfg, strategy_from_config(strategy_name, cfg, best), enforce_drawdown_kill=kill).run(data, start=te0, end=te1)
        windows.append(WFWindow(tr0, tr1, te0, te1, {k: best.get(k) for k in keys}, best_val, rt.metrics))
        if len(rt.equity) > 1:
            oos_rets.append(rt.equity.pct_change().fillna(rt.equity.iloc[0] / cfg.account.starting_equity - 1))
        oos_trades.extend(rt.trades)
        s += wf.test_bars
    if oos_rets:
        rets = pd.concat(oos_rets).sort_index()
        rets = rets[~rets.index.duplicated(keep="first")]
        eq = cfg.account.starting_equity * (1 + rets).cumprod()
    else:
        eq = pd.Series(dtype=float)
        notes.append("not enough data for a single walk-forward window")
    m = compute_metrics(eq, oos_trades, cfg.account.starting_equity)
    return WalkForwardResult(windows, m, per_pair_metrics(oos_trades), eq, len(combos), notes)
