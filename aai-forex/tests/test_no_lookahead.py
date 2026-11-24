"""No-lookahead guarantees: causal features, lag-only context, next-bar fills."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from aai_fx.backtest.engine import BacktestEngine
from aai_fx.strategies import SessionBreakout, TrendSwing
from aai_fx.strategies.base import BarContext, LookaheadError, Signal, SignalAction, Strategy
from aai_fx.strategies.indicators import align_htf, daily_bars

from .conftest import synth_ohlc


def _assert_prefix_invariant(strat: Strategy, df: pd.DataFrame, cuts: list[int]) -> None:
    full = strat.prepare(df, "EURUSD")
    for k in cuts:
        part = strat.prepare(df.iloc[:k], "EURUSD")
        a, b = full.iloc[:k], part
        pd.testing.assert_frame_equal(a, b, check_exact=False, rtol=1e-10, atol=1e-12,
                                      obj=f"{strat.name} features truncated at {k}")


def test_trend_swing_d1_features_are_causal() -> None:
    df = synth_ohlc(600, freq="1D", seed=1)
    _assert_prefix_invariant(TrendSwing("D1", ema_fast=10, ema_slow=50), df, [60, 200, 377, 599])


def test_trend_swing_h4_with_daily_bias_is_causal() -> None:
    df = synth_ohlc(1500, freq="4h", seed=2)
    _assert_prefix_invariant(TrendSwing("H4", ema_fast=5, ema_slow=20), df, [100, 433, 1001, 1499])


def test_session_breakout_features_are_causal() -> None:
    df = synth_ohlc(3000, freq="15min", seed=3)
    _assert_prefix_invariant(SessionBreakout("M15"), df, [97, 500, 1234, 2999])


def test_future_perturbation_does_not_change_past(cfg) -> None:  # type: ignore[no-untyped-def]
    """Scramble everything after bar k: the equity curve and trades up to k must be identical."""
    for name, freq, n in (("trend_swing", "1D", 500), ("session_breakout", "15min", 4000)):
        sc = cfg.strategies[name]
        from aai_fx.strategies import strategy_from_config
        data = {"EURUSD": synth_ohlc(n, freq=freq, seed=5), "USDJPY": synth_ohlc(n, freq=freq, seed=6, p0=150.0)}
        k = int(n * 0.6)
        pert = {}
        for p, df in data.items():
            d = df.copy()
            rng = np.random.default_rng(99)
            noise = np.exp(rng.normal(0, 0.01, len(d) - k))
            for c in ("open", "high", "low", "close"):
                d.iloc[k:, d.columns.get_loc(c)] = d[c].iloc[k:].to_numpy() * noise
            d["high"] = d[["open", "high", "low", "close"]].max(axis=1)
            d["low"] = d[["open", "high", "low", "close"]].min(axis=1)
            pert[p] = d
        r1 = BacktestEngine(cfg, strategy_from_config(name, cfg)).run(data)
        r2 = BacktestEngine(cfg, strategy_from_config(name, cfg)).run(pert)
        cutoff = data["EURUSD"].index[k]  # first perturbed bar open; equity at closes <= cutoff unaffected
        e1, e2 = r1.equity[r1.equity.index <= cutoff], r2.equity[r2.equity.index <= cutoff]
        assert len(e1) > 10
        pd.testing.assert_series_equal(e1, e2)
        t1 = [t.to_dict() for t in r1.trades if t.exit_ts < cutoff]
        t2 = [t.to_dict() for t in r2.trades if t.exit_ts < cutoff]
        assert len(t1) > 0, f'{name}: test is vacuous without trades before the cutoff'
        assert t1 == t2, name
        assert len(r1.trades) != len(r2.trades) or r1.equity.iloc[-1] != r2.equity.iloc[-1]  # future did change
        assert sc.timeframe


def test_bar_context_refuses_negative_lag() -> None:
    idx = pd.date_range("2024-01-01", periods=5, freq="1D", tz="UTC")
    ctx = BarContext("EURUSD", 2, idx, {"close": np.arange(5.0)}, pd.Timedelta(days=1), None)
    assert ctx.get("close") == 2.0 and ctx.get("close", 1) == 1.0
    with pytest.raises(LookaheadError):
        ctx.get("close", -1)


class _BuyOnBar(Strategy):
    """Emits one long signal at bar `at` to check fill timing."""
    name = "probe"

    def __init__(self, at: int) -> None:
        self.at = at
        super().__init__("D1")

    @property
    def warmup_bars(self) -> int:
        return 0

    def prepare(self, df: pd.DataFrame, pair: str) -> pd.DataFrame:
        return df.copy()

    def on_bar(self, ctx: BarContext) -> list[Signal]:
        if ctx.i == self.at and ctx.position is None:
            c = ctx.get("close")
            return [Signal(ctx.close_ts, ctx.pair, self.name, SignalAction.ENTER_LONG, c, stop=c * 0.99)]
        return []


def test_orders_fill_at_next_bar_open(cfg) -> None:  # type: ignore[no-untyped-def]
    df = synth_ohlc(50, freq="1D", seed=7)
    res = BacktestEngine(cfg, _BuyOnBar(at=10)).run({"EURUSD": df})
    t = res.trades[0]
    assert t.entry_ts == df.index[11]  # signal at close of bar 10 -> fill at open of bar 11
    c = cfg.costs.for_pair("EURUSD")
    expected = df["open"].iloc[11] + (c.spread_pips / 2 + c.slippage_pips) * 0.0001
    assert t.entry_price == pytest.approx(expected, rel=1e-12)


def test_htf_bias_only_uses_completed_days() -> None:
    df = synth_ohlc(24 * 10, freq="1h", seed=8, session_only=False)
    d = daily_bars(df, TrendSwing("H1").timeframe)
    d = d.assign(dclose=d["close"])
    al = align_htf(d[["dclose"]], pd.Timedelta(days=1), df.index, pd.Timedelta(hours=1))
    for ts in df.index:
        v = al.loc[ts, "dclose"]
        bar_close = ts + pd.Timedelta(hours=1)
        visible = d[d.index + pd.Timedelta(days=1) <= bar_close]
        if visible.empty:
            assert np.isnan(v)
        else:
            assert v == visible["dclose"].iloc[-1]
    # at 10:00 on day 3 we must see day 2's close, not day 3's
    ts = df.index[df.index.normalize() == d.index[2]][10]
    assert al.loc[ts, "dclose"] == d["dclose"].iloc[1]
