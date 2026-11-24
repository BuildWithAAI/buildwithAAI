"""Out-of-sample split, rolling walk-forward and parameter-sensitivity grid (overfitting checks)."""
from __future__ import annotations

import itertools
from dataclasses import dataclass, field
from datetime import timedelta

import pandas as pd

from ..config import Settings, StrategyCfg
from ..market.data import MarketData
from ..models import Signal
from ..strategy import EventCalendar, FilterContext, build_setups
from .engine import BacktestResult, run_backtest
from .metrics import spearman, summarize


def grid_configs(base: StrategyCfg, grid: dict[str, list]) -> list[StrategyCfg]:
    keys = list(grid)
    return [base.model_copy(update=dict(zip(keys, vals))) for vals in itertools.product(*(grid[k] for k in keys))]


def cfg_key(cfg: StrategyCfg, grid: dict[str, list]) -> str:
    return ",".join(f"{k}={getattr(cfg, k)}" for k in grid)


_SETUP_KEYS = ("rules", "scenario_strength", "require_bias_alignment", "btc_filter", "skip_indecisive",
               "skip_on_position_mismatch", "max_level_distance_pct", "signal_ttl_hours")


class _Cache:
    def __init__(self) -> None:
        self.setups: dict = {}
        self.corr: dict = {}


def run_cfg(signals: list[Signal], md: MarketData, settings: Settings, cfg: StrategyCfg,
            cal: EventCalendar, start, end, cache: _Cache | None = None, start_equity: float | None = None
            ) -> BacktestResult:
    cache = cache or _Cache()
    k = tuple(str(getattr(cfg, x)) for x in _SETUP_KEYS)
    if k not in cache.setups:
        cache.setups[k] = build_setups(signals, cfg, md.h1, md.d1.get("BTC"), FilterContext())
    return run_backtest(cache.setups[k], md, settings, strategy=cfg, calendar=cal, start=start, end=end,
                        start_equity=start_equity, corr_cache=cache.corr)


def _score(r: BacktestResult, settings: Settings) -> dict:
    m = summarize(r.trades_df(), r.equity, settings.backtest.start_equity)
    return m


@dataclass
class ValidationResult:
    split_ts: str
    is_metrics: dict
    oos_metrics: dict
    grid: list[dict] = field(default_factory=list)
    grid_rank_corr: float | None = None
    best_is_key: str | None = None
    best_is_oos: dict | None = None
    walk_forward: list[dict] = field(default_factory=list)
    wf_oos_metrics: dict | None = None
    flags: list[str] = field(default_factory=list)
    wf_result: BacktestResult | None = None


def validate(signals: list[Signal], md: MarketData, settings: Settings, cal: EventCalendar,
             start: pd.Timestamp, end: pd.Timestamp) -> ValidationResult:
    bt = settings.backtest
    span = end - start
    split = start + span * (1 - bt.oos_fraction)
    base = settings.strategy
    C = _Cache()
    is_r = run_cfg(signals, md, settings, base, cal, start, split, C)
    oos_r = run_cfg(signals, md, settings, base, cal, split, end, C)
    res = ValidationResult(split.isoformat(), _score(is_r, settings), _score(oos_r, settings))

    # parameter grid: IS vs OOS
    rows = []
    for cfg in grid_configs(base, bt.grid):
        mi = _score(run_cfg(signals, md, settings, cfg, cal, start, split, C), settings)
        mo = _score(run_cfg(signals, md, settings, cfg, cal, split, end, C), settings)
        rows.append({"key": cfg_key(cfg, bt.grid), "is_trades": mi["trades"], "is_avg_r": mi["avg_r"],
                     "is_return_pct": mi["return_pct"], "oos_trades": mo["trades"], "oos_avg_r": mo["avg_r"],
                     "oos_return_pct": mo["return_pct"]})
    res.grid = rows
    ok = [r for r in rows if r["is_trades"] >= bt.min_trades_for_selection and r["oos_avg_r"] is not None]
    res.grid_rank_corr = spearman([r["is_avg_r"] for r in ok], [r["oos_avg_r"] for r in ok])
    if ok:
        best = max(ok, key=lambda r: r["is_avg_r"])
        res.best_is_key = best["key"]
        res.best_is_oos = best
        if best["is_avg_r"] > 0 and best["oos_avg_r"] <= 0:
            res.flags.append("OVERFIT: best in-sample config loses out-of-sample")
    if res.grid_rank_corr is not None and res.grid_rank_corr < 0.3:
        res.flags.append(f"LOW IS->OOS rank correlation across grid ({res.grid_rank_corr:.2f}): "
                         "parameter choice does not generalise")
    pos = [r for r in rows if r["is_avg_r"] is not None and r["is_avg_r"] > 0]
    res.flags.append(f"{len(pos)}/{len(rows)} grid configs have positive in-sample avg R")

    # rolling walk-forward: pick best on train window, trade the next test window
    cfgs = grid_configs(base, bt.grid)
    t0 = start
    wf_trades = []
    folds = []
    eq = bt.start_equity
    curves = []
    while t0 + timedelta(days=bt.wf_train_days + bt.wf_test_days) <= end + timedelta(days=bt.wf_test_days):
        tr_end = t0 + timedelta(days=bt.wf_train_days)
        te_end = min(tr_end + timedelta(days=bt.wf_test_days), end)
        if tr_end >= end:
            break
        best_cfg, best_r = None, None
        for cfg in cfgs:
            m = _score(run_cfg(signals, md, settings, cfg, cal, t0, tr_end, C), settings)
            if m["trades"] >= bt.min_trades_for_selection and (best_r is None or m["avg_r"] > best_r):
                best_cfg, best_r = cfg, m["avg_r"]
        best_cfg = best_cfg or base
        r = run_cfg(signals, md, settings, best_cfg, cal, tr_end, te_end, C, start_equity=eq)
        m = summarize(r.trades_df(), r.equity, eq)
        folds.append({"train": f"{t0.date()}..{tr_end.date()}", "test": f"{tr_end.date()}..{te_end.date()}",
                      "chosen": cfg_key(best_cfg, bt.grid), "train_avg_r": best_r,
                      "test_trades": m["trades"], "test_avg_r": m["avg_r"], "test_return_pct": m["return_pct"]})
        wf_trades.extend(r.trades)
        if not r.equity.empty:
            curves.append(r.equity)
            eq = float(r.equity.iloc[-1])
        t0 = t0 + timedelta(days=bt.wf_test_days)
    res.walk_forward = folds
    if curves:
        wf_eq = pd.concat(curves)
        wf_eq = wf_eq[~wf_eq.index.duplicated(keep="last")]
        wf = BacktestResult(wf_trades, wf_eq)
        res.wf_result = wf
        res.wf_oos_metrics = summarize(wf.trades_df(), wf_eq, bt.start_equity)
    deg = (res.is_metrics.get("avg_r"), res.oos_metrics.get("avg_r"))
    if deg[0] is not None and deg[1] is not None and deg[0] > 0 and deg[1] < deg[0] * 0.5:
        res.flags.append("DEGRADATION: OOS avg R is less than half of IS avg R")
    return res
