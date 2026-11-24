"""Backtest harness primitives (Phase 1: metrics + walk-forward splitter; per-sector strategies are Phase 2).
Metrics are computed in R-multiples and on an equity curve; no metric is reported without its sample size."""
from __future__ import annotations
import math, statistics


def metrics(r_multiples: list[float], risk_frac: float = 0.01, periods_per_year: float | None = None) -> dict:
    n = len(r_multiples)
    if n == 0:
        return {"n": 0, "note": "no trades"}
    wins = [r for r in r_multiples if r > 0]
    losses = [r for r in r_multiples if r <= 0]
    eq, peak, mdd, curve = 1.0, 1.0, 0.0, []
    rets = []
    for r in r_multiples:
        ret = r * risk_frac
        rets.append(ret)
        eq *= 1 + ret
        peak = max(peak, eq)
        mdd = max(mdd, (peak - eq) / peak)
        curve.append(eq)
    sd = statistics.pstdev(rets) if n > 1 else 0.0
    sharpe_trade = (statistics.mean(rets) / sd) if sd > 0 else None
    out = {"n": n, "hit_rate": len(wins) / n, "expectancy_R": sum(r_multiples) / n,
           "avg_win_R": (sum(wins) / len(wins)) if wins else 0.0, "avg_loss_R": (sum(losses) / len(losses)) if losses else 0.0,
           "profit_factor": (sum(wins) / -sum(losses)) if losses and sum(losses) < 0 else None,
           "max_drawdown": mdd, "total_return": eq - 1, "sharpe_per_trade": sharpe_trade,
           "small_sample_warning": n < 30}
    if periods_per_year and sharpe_trade is not None:
        out["sharpe_annualized"] = sharpe_trade * math.sqrt(periods_per_year)
    return out


def walk_forward_splits(n: int, train: int, test: int, step: int | None = None, anchored: bool = False):
    """Yield (train_idx, test_idx) ranges with no overlap and no look-ahead (test strictly after train)."""
    step = step or test
    start = 0
    while True:
        tr_lo = 0 if anchored else start
        tr_hi = start + train
        te_hi = tr_hi + test
        if te_hi > n:
            return
        yield range(tr_lo, tr_hi), range(tr_hi, te_hi)
        start += step


def simulate_bracket(candles: list[dict], side: str, entry: float, stop: float, target: float, start_idx: int = 0) -> dict:
    """Walk candles from start_idx; if stop and target are both inside one candle, assume STOP first (conservative)."""
    risk = abs(entry - stop)
    for i in range(start_idx, len(candles)):
        h, l = candles[i]["h"], candles[i]["l"]
        hit_stop = l <= stop if side == "long" else h >= stop
        hit_tgt = h >= target if side == "long" else l <= target
        if hit_stop:
            return {"outcome": "stop", "idx": i, "R": -1.0, "ambiguous": hit_tgt}
        if hit_tgt:
            return {"outcome": "target", "idx": i, "R": abs(target - entry) / risk, "ambiguous": False}
    last = candles[-1]["c"] if candles else entry
    r = ((last - entry) if side == "long" else (entry - last)) / risk
    return {"outcome": "open", "idx": len(candles) - 1, "R": r, "ambiguous": False}
