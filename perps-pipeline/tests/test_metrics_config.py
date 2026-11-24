import math
from pathlib import Path

import numpy as np
import pandas as pd

from perps.backtest.engine import BacktestResult
from perps.config import load_settings
from perps.evaluation.metrics import compute_metrics

ROOT = Path(__file__).resolve().parents[1]


def test_repo_configs_load_and_are_safe():
    s = load_settings(ROOT / "config" / "default.yaml", ROOT / "config" / "strategies.yaml")
    assert s.execution.enabled is False
    assert 0.01 <= s.risk.risk_per_trade <= s.risk.hard_cap <= 0.03
    assert {"range_breakout", "ema_pullback", "vol_squeeze"} <= set(s.strategies)


def test_metrics_on_known_curve():
    idx = pd.date_range("2025-01-01", periods=11, freq="D", tz="UTC")
    eq = pd.Series([100, 110, 99, 99, 105, 105, 105, 105, 105, 105, 120.0], index=idx)
    trades = pd.DataFrame({"net_pnl": [10, -11, 6, 15], "r_multiple": [1.0, -1.1, 0.6, 1.5], "fees": [0.1] * 4,
                           "funding": [0.0] * 4, "gross_pnl": [10.1, -10.9, 6.1, 15.1], "implied_leverage": [1.0] * 4,
                           "notional": [100.0] * 4, "side": ["long"] * 4, "exit_reason": ["take_profit"] * 4,
                           "bars_held": [1] * 4})
    m = compute_metrics(BacktestResult(trades, eq, pd.Series(0.5, index=idx), 100.0))
    assert math.isclose(m["net_return"], 0.2)
    assert math.isclose(m["max_drawdown"], 99 / 110 - 1)
    assert math.isclose(m["win_rate"], 0.75)
    assert math.isclose(m["profit_factor"], 31 / 11)
    r = pd.concat([pd.Series([0.0]), eq.pct_change().dropna()])  # leading day at initial equity
    assert math.isclose(m["sharpe"], r.mean() / r.std() * np.sqrt(365), rel_tol=1e-6)
