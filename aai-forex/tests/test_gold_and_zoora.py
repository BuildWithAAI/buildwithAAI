"""Gold (XAUUSD) contract maths, broker-symbol handling, swaps and the Zoora strategy family."""

from __future__ import annotations

import math

import numpy as np
import pandas as pd
import pytest

from aai_fx.backtest.engine import BacktestEngine
from aai_fx.config import AppConfig, CostConfig, InstrumentSpec, PairCost
from aai_fx.execution.paper import PaperBroker
from aai_fx.instruments import INSTRUMENTS, get_instrument, normalize_symbol, register_instrument
from aai_fx.risk.pip import pip_value_per_lot
from aai_fx.risk.sizing import position_size
from aai_fx.strategies import ZooraCross, ZooraPullback, ZooraTrend, ema_warmup_bars
from aai_fx.strategies.base import BarContext

from .conftest import synth_ohlc

RATES = {"XAUUSD": 2400.0, "AUDUSD": 0.65, "EURUSD": 1.10}


@pytest.fixture
def restore_gold():  # type: ignore[no-untyped-def]
    orig = INSTRUMENTS["XAUUSD"]
    yield
    INSTRUMENTS["XAUUSD"] = orig


# ----------------------------------------------------------------- symbols
@pytest.mark.parametrize("raw,canon", [("XAUUSD+", "XAUUSD"), ("AUDUSD+", "AUDUSD"), ("xauusd", "XAUUSD"),
                                       ("GC=F", "XAUUSD"), ("AUDUSD=X", "AUDUSD"), ("EURUSD.pro", "EURUSD")])
def test_bybit_suffix_normalisation(raw: str, canon: str) -> None:
    assert normalize_symbol(raw) == canon


# ------------------------------------------------------------- gold maths
def test_gold_default_spec_100oz() -> None:
    g = get_instrument("XAUUSD+")
    assert (g.base, g.quote, g.contract_size, g.pip_size) == ("XAU", "USD", 100.0, 0.01)
    # $1.00 move on 1.00 lot = 100 oz * $1 = $100 ; one 0.01 "pip"/point = $1 per lot
    assert pip_value_per_lot("XAUUSD", "USD", RATES) == pytest.approx(1.0)
    assert 1.00 / g.pip_size * pip_value_per_lot("XAUUSD", "USD", RATES) == pytest.approx(100.0)
    assert g.usd_direction(+1) == -1  # long gold = short USD exposure bucket


def test_gold_sizing_exact() -> None:
    # $10,000, 1% = $100 risk, $10 stop -> 100 / (10 * 100) = 0.10 lot
    r = position_size("XAUUSD", 10_000, 1.0, entry=2400.0, stop=2390.0, account_ccy="USD", rates=RATES)
    assert r.lots == pytest.approx(0.10)
    assert r.stop_pips == pytest.approx(1000.0)
    assert r.risk_amount_actual == pytest.approx(100.0)


def test_gold_sizing_rounds_down_and_rejects_too_wide() -> None:
    # $7.30 stop: raw 0.136986 -> 0.13 lot (never rounds up)
    r = position_size("XAUUSD", 10_000, 1.0, 2400.0, 2392.70, "USD", RATES)
    assert r.lots == pytest.approx(0.13) and r.risk_amount_actual <= 100.0 + 1e-9
    # $150 stop: even 0.01 lot (1 oz) risks $150 > $100 budget -> rejected, not over-risked
    r = position_size("XAUUSD", 10_000, 1.0, 2400.0, 2250.0, "USD", RATES)
    assert r.lots == 0.0 and r.rejected_reason
    # with costs (30 points spread+slip) the stop budget includes them
    r = position_size("XAUUSD", 10_000, 1.0, 2400.0, 2390.0, "USD", RATES, cost_pips=30)
    assert r.lots == pytest.approx(0.09) and r.risk_amount_actual <= 100.0


def test_gold_sizing_never_over_risks_random() -> None:
    rng = np.random.default_rng(7)
    for _ in range(1000):
        eq = float(rng.uniform(2_000, 500_000))
        px = float(rng.uniform(800, 3500))
        stop = px - float(rng.uniform(0.5, 120)) * rng.choice([-1, 1])
        risk = float(rng.uniform(1, 3))
        r = position_size("XAUUSD", eq, risk, px, stop, "USD", RATES, cost_pips=float(rng.uniform(0, 60)))
        assert r.risk_amount_actual <= eq * risk / 100 + 1e-6


def test_gold_broker_spec_override(restore_gold) -> None:  # type: ignore[no-untyped-def]
    cfg = AppConfig(instruments={"XAUUSD+": InstrumentSpec(contract_size=10.0, min_lot=0.1, broker_symbol="XAUUSD+")})
    cfg.apply_instruments()
    g = get_instrument("XAUUSD")
    assert g.contract_size == 10.0 and g.min_lot == 0.1 and g.broker_symbol == "XAUUSD+"
    assert pip_value_per_lot("XAUUSD", "USD", RATES) == pytest.approx(0.1)
    r = position_size("XAUUSD", 10_000, 1.0, 2400.0, 2390.0, "USD", RATES)
    assert r.lots == pytest.approx(1.0)  # 100 / (10 * 10 oz)


def test_gold_paper_pnl_and_commission() -> None:
    costs = CostConfig(commission_per_lot_side=3.5,
                       per_pair={"XAUUSD": PairCost(spread_pips=0, slippage_pips=0, stop_slippage_pips=0,
                                                    commission_per_lot_side=5.0)})
    b = PaperBroker(10_000, "USD", costs)
    t0 = pd.Timestamp("2025-01-06 10:00", tz="UTC")
    b.submit_market("XAUUSD", +1, 0.10, t0, stop=2390.0)
    rates = dict(RATES)
    b.process_bar("XAUUSD", t0 + pd.Timedelta(hours=1), 2400, 2401, 2399, 2400, rates)
    b.submit_close("XAUUSD", t0 + pd.Timedelta(hours=1))
    closed = b.process_bar("XAUUSD", t0 + pd.Timedelta(hours=2), 2410, 2411, 2409, 2410, rates)
    t = closed[0] if closed else b.trades[-1]
    assert t.gross_pnl == pytest.approx(100.0)  # $10 * 0.1 lot * 100 oz
    assert t.commission == pytest.approx(1.0)   # 2 sides * 0.1 lot * $5
    assert t.r_multiple == pytest.approx(99.0 / 100.0)


def test_swap_accrues_per_night_and_hits_net() -> None:
    costs = CostConfig(commission_per_lot_side=0.0,
                       per_pair={"XAUUSD": PairCost(spread_pips=0, slippage_pips=0, stop_slippage_pips=0,
                                                    swap_long_pct_pa=-3.65)})
    b = PaperBroker(100_000, "USD", costs)
    rates = dict(RATES)
    t0 = pd.Timestamp("2025-01-06 00:00", tz="UTC")  # Monday
    b.submit_market("XAUUSD", +1, 1.0, t0, stop=1900.0)
    for d in range(1, 8):  # daily bars through next Monday (7 nights after entry day)
        b.process_bar("XAUUSD", t0 + pd.Timedelta(days=d), 2000, 2000, 2000, 2000, rates)
    # entry fills on day 1 at 2000; 6 nights to day 7; notional 1 lot * 100 oz * $2000 = $200k
    expected = 200_000 * -3.65 / 100 / 365 * 6
    assert b.total_swap == pytest.approx(expected)
    b.submit_close("XAUUSD", t0 + pd.Timedelta(days=7))
    b.process_bar("XAUUSD", t0 + pd.Timedelta(days=7, hours=1), 2000, 2000, 2000, 2000, rates)
    assert b.trades[-1].swap == pytest.approx(expected)
    assert b.trades[-1].net_pnl == pytest.approx(expected)
    assert b.cash == pytest.approx(100_000 + expected)


# ------------------------------------------------------------------ Zoora
def test_ema_warmup_bars() -> None:
    assert ema_warmup_bars(800) == 1843 and ema_warmup_bars(792) == 1824
    a = 2 / 801
    assert (1 - a) ** 1843 < 0.01 <= (1 - a) ** 1842


@pytest.mark.parametrize("cls", [ZooraTrend, ZooraPullback, ZooraCross])
def test_zoora_features_causal_and_masked(cls) -> None:  # type: ignore[no-untyped-def]
    df = synth_ohlc(1400, freq="1h", seed=11, p0=2000.0, vol=0.002)
    s = cls("H1", ema_fast=40, ema_slow=160)
    full = s.prepare(df, "XAUUSD")
    for k in (300, 777, 1399):
        pd.testing.assert_frame_equal(full.iloc[:k], s.prepare(df.iloc[:k], "XAUUSD"), check_exact=False,
                                      rtol=1e-10, atol=1e-12)
    w = s.warmup_bars
    assert w == ema_warmup_bars(160)
    assert full["ema_s"].iloc[:w].isna().all() and full["ema_s"].iloc[w:].notna().all()


@pytest.mark.parametrize("cls", [ZooraTrend, ZooraPullback, ZooraCross])
def test_zoora_no_trades_during_warmup(cls) -> None:  # type: ignore[no-untyped-def]
    df = synth_ohlc(2500, freq="1h", seed=12, p0=0.65, vol=0.002)
    s = cls("H1", ema_fast=50, ema_slow=200)
    cfg = AppConfig(pairs=["AUDUSD"])
    r = BacktestEngine(cfg, s, enforce_drawdown_kill=False).run({"AUDUSD": df})
    first_ok = df.index[s.warmup_bars]
    assert all(t.entry_ts > first_ok for t in r.trades)
    assert r.trades, "synthetic walk should produce at least one trade after warm-up"


def _ctx_series(cls, closes: list[float], **p):  # type: ignore[no-untyped-def]
    idx = pd.date_range("2024-01-01", periods=len(closes), freq="1D", tz="UTC")
    c = np.array(closes, float)
    df = pd.DataFrame({"open": c, "high": c * 1.001, "low": c * 0.999, "close": c, "volume": 0.0}, index=idx)
    s = cls("D1", ema_fast=3, ema_slow=12, seed_weight=0.5, **p)
    f = s.prepare(df, "AUDUSD")
    cols = {k: f[k].to_numpy(float) for k in f.columns}
    return s, f, idx, cols


def test_zoora_cross_enters_on_cross_only() -> None:
    closes = [1.0] * 30 + [0.9] * 30 + [1.2] * 30
    s, f, idx, cols = _ctx_series(ZooraCross, closes, stop_atr=3.0)
    sigs = []
    for i in range(s.warmup_bars, len(idx)):
        sigs += [(i, x.action.value) for x in s.on_bar(BarContext("AUDUSD", i, idx, cols, pd.Timedelta(days=1), None))]
    acts = [a for _, a in sigs]
    assert acts.count("ENTER_SHORT") == 1 and acts.count("ENTER_LONG") == 1
    first_long = next(i for i, a in sigs if a == "ENTER_LONG")
    assert f["fs_sign"].iloc[first_long] > 0 and f["fs_sign"].iloc[first_long - 1] < 0


def test_zoora_trend_requires_regime_transition() -> None:
    closes = list(np.linspace(1.0, 0.9, 30)) + list(np.linspace(0.9, 1.3, 60))
    s, f, idx, cols = _ctx_series(ZooraTrend, closes)
    longs = [i for i in range(s.warmup_bars, len(idx))
             for x in s.on_bar(BarContext("AUDUSD", i, idx, cols, pd.Timedelta(days=1), None))
             if x.action.value == "ENTER_LONG"]
    assert longs and all(f["regime"].iloc[i] == 1 and f["regime"].iloc[i - 1] != 1 for i in longs)
    assert all(not math.isnan(f["ema_s"].iloc[i]) for i in longs)


def test_stop_atr_schedule_is_time_based():
    from aai_fx.strategies import make_strategy
    s = make_strategy("zoora_trend", "D1", {"stop_atr": 3.0, "stop_atr_schedule": [("2020-01-01T00:00:00+00:00", 2.0),
                                                             ("2021-01-01T00:00:00+00:00", 3.0)]})
    assert s._stop_atr(pd.Timestamp("2019-06-01", tz="UTC")) == 3.0
    assert s._stop_atr(pd.Timestamp("2020-06-01", tz="UTC")) == 2.0
    assert s._stop_atr(pd.Timestamp("2021-06-01", tz="UTC")) == 3.0


def test_research_common_warmup_is_ema800():
    from aai_fx.research.zoora import COMMON_WARMUP
    assert COMMON_WARMUP == 1843
