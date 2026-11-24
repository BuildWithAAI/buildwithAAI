"""Causality: a strategy's output for bar t must depend only on bars <= t."""

import numpy as np
import pandas as pd
import pytest

from perps.strategies import REGISTRY, build_strategy

from .conftest import random_walk

FAST = {"range_breakout": {"lookback_hours": 12, "trend_ema": 50},
        "ema_pullback": {"trend_ema": 100},
        "vol_squeeze": {"squeeze_lookback": 60}}


@pytest.mark.parametrize("name", sorted(REGISTRY))
@pytest.mark.parametrize("tf", ["15m", "1H"])
def test_prefix_invariance(name, tf):
    df = random_walk(2500, seed=7, vol=0.012)
    strat = build_strategy(name, tf, FAST.get(name, {}))
    full = strat.compute(df)
    assert full["signal"].abs().sum() > 0, "test data should produce some signals"
    for cut in (800, 1500, 2200):
        part = strat.compute(df.iloc[:cut])
        pd.testing.assert_frame_equal(part, full.iloc[:cut], check_exact=False, rtol=1e-9)


@pytest.mark.parametrize("name", sorted(REGISTRY))
def test_future_perturbation_does_not_change_past(name):
    df = random_walk(2000, seed=3, vol=0.012)
    strat = build_strategy(name, "1H", FAST.get(name, {}))
    base = strat.compute(df)
    shocked = df.copy()
    k = 1500
    rng = np.random.default_rng(0)
    for col in ("open", "high", "low", "close"):
        shocked.iloc[k:, shocked.columns.get_loc(col)] *= 1 + rng.normal(0, 0.05, len(df) - k)
    shocked["high"] = shocked[["open", "high", "low", "close"]].max(axis=1)
    shocked["low"] = shocked[["open", "high", "low", "close"]].min(axis=1)
    shocked.iloc[k:, shocked.columns.get_loc("volume")] *= 10
    after = strat.compute(shocked)
    pd.testing.assert_frame_equal(after.iloc[:k], base.iloc[:k])


def test_engine_never_trades_on_signal_bar(settings, unit_spec):
    from perps.backtest.engine import BacktestEngine, SymbolData

    df = random_walk(2500, seed=11, vol=0.012)
    strat = build_strategy("range_breakout", "1H", FAST["range_breakout"])
    sig = strat.compute(df)["signal"]
    res = BacktestEngine(settings, "blofin").run(strat, [SymbolData("UNIT-USDT", df, unit_spec)])
    assert len(res.trades) > 0
    for _, t in res.trades.iterrows():
        et = pd.Timestamp(t.entry_time)
        i = df.index.get_loc(et)
        assert sig.iloc[i - 1] != 0, "entry must follow a signal on the PREVIOUS bar"
        o = df["open"].iloc[i]
        slip = settings.slippage.market_bps / 1e4
        assert np.isclose(t.entry_price, o * (1 + slip) if t.side == "long" else o * (1 - slip))
