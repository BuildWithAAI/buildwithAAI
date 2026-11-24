from __future__ import annotations

import pandas as pd
import pytest

from aai_fx.config import RiskConfig
from aai_fx.risk.kill_switch import KillSwitch
from aai_fx.risk.manager import OpenRisk, RiskManager

RATES = {"EURUSD": 1.10, "GBPUSD": 1.25, "USDJPY": 150.0, "USDCHF": 0.90, "AUDUSD": 0.65, "USDCAD": 1.35,
         "NZDUSD": 0.60}
T0 = pd.Timestamp("2024-03-04 10:00", tz="UTC")


def _rm(**kw) -> RiskManager:  # type: ignore[no-untyped-def]
    rm = RiskManager(RiskConfig(**kw), "USD", KillSwitch(None))
    rm.on_equity(T0, 10_000)
    return rm


def _long(rm: RiskManager, pair: str, open_: list[OpenRisk], eq: float = 10_000):  # type: ignore[no-untyped-def]
    px = RATES[pair]
    pip = 0.01 if pair.endswith("JPY") else 0.0001
    return rm.evaluate(pair, +1, px, px - 25 * pip, eq, open_, RATES)


def test_basic_approval_and_risk_pct() -> None:
    d = _long(_rm(), "EURUSD", [])
    assert d.approved and d.lots == pytest.approx(0.40) and d.risk_pct <= 1.0 + 1e-9


def test_risk_pct_clamped_to_3() -> None:
    rm = _rm(risk_per_trade_pct=3.0)
    d = rm.evaluate("EURUSD", 1, 1.1, 1.0975, 10_000, [], RATES, risk_pct=10.0)
    assert d.approved and d.risk_pct <= 3.0 + 1e-9


def test_max_open_risk() -> None:
    rm = _rm(max_open_risk_pct=2.5, max_correlated_risk_pct=10, max_positions_per_usd_direction=10)
    open_ = [OpenRisk("EURUSD", 1, 100.0), OpenRisk("USDJPY", 1, 100.0)]
    d = _long(rm, "AUDUSD", open_)
    assert not d.approved and "open risk" in d.reasons[-1]


def test_daily_loss_limit_blocks_entries() -> None:
    rm = _rm(daily_loss_limit_pct=3.0)
    d = _long(rm, "EURUSD", [], eq=9_650)  # -3.5% on the day
    assert not d.approved and "daily loss" in d.reasons[-1]
    rm.on_equity(T0 + pd.Timedelta(days=1), 9_650)  # new UTC day resets the baseline
    assert _long(rm, "EURUSD", [], eq=9_650).approved


def test_correlated_usd_count_limit() -> None:
    rm = _rm(max_positions_per_usd_direction=3, max_correlated_risk_pct=10, max_open_risk_pct=10)
    # long EURUSD, long GBPUSD, short USDJPY = 3x short USD
    open_ = [OpenRisk("EURUSD", 1, 100.0), OpenRisk("GBPUSD", 1, 100.0), OpenRisk("USDJPY", -1, 100.0)]
    d = _long(rm, "AUDUSD", open_)  # 4th short-USD
    assert not d.approved and "short USD" in d.reasons[-1]
    # long USDCAD is long USD -> allowed
    assert _long(rm, "USDCAD", open_).approved


def test_correlated_usd_risk_pct_limit() -> None:
    rm = _rm(max_correlated_risk_pct=2.5, max_positions_per_usd_direction=10, max_open_risk_pct=10)
    open_ = [OpenRisk("EURUSD", 1, 100.0), OpenRisk("NZDUSD", 1, 100.0)]
    d = _long(rm, "GBPUSD", open_)
    assert not d.approved and "correlated USD risk" in d.reasons[-1]


def test_kill_switch_file_blocks_everything(tmp_path) -> None:  # type: ignore[no-untyped-def]
    flag = tmp_path / "KILL"
    ks = KillSwitch(flag)
    rm = RiskManager(RiskConfig(), "USD", ks)
    rm.on_equity(T0, 10_000)
    assert _long(rm, "EURUSD", []).approved
    flag.write_text('{"reason": "operator halt"}')
    d = _long(rm, "EURUSD", [])
    assert not d.approved and "KILL SWITCH" in d.reasons[0] and "operator halt" in d.reasons[0]
    ks.reset()
    assert not flag.exists() and _long(rm, "EURUSD", []).approved


def test_drawdown_triggers_kill_switch_and_stays_on() -> None:
    rm = _rm(kill_switch_drawdown_pct=10.0)
    rm.on_equity(T0 + pd.Timedelta(hours=1), 11_000)
    rm.on_equity(T0 + pd.Timedelta(days=2), 9_800)  # -10.9% from peak
    assert rm.kill.engaged
    rm.on_equity(T0 + pd.Timedelta(days=3), 12_000)  # recovery does NOT auto-reset
    assert not _long(rm, "EURUSD", [], eq=12_000).approved


def test_drawdown_kill_can_be_disabled_for_research_but_breach_recorded() -> None:
    rm = RiskManager(RiskConfig(kill_switch_drawdown_pct=10.0), "USD", KillSwitch(None), drawdown_kill_enabled=False)
    rm.on_equity(T0, 10_000)
    rm.on_equity(T0 + pd.Timedelta(days=2), 8_500)
    assert not rm.kill.engaged and rm.first_drawdown_breach is not None


def test_persisted_kill_switch(tmp_path) -> None:  # type: ignore[no-untyped-def]
    ks = KillSwitch(tmp_path / "state" / "KILL")
    ks.engage("test", persist=True)
    assert KillSwitch(tmp_path / "state" / "KILL").engaged


def test_wrong_side_stop_and_duplicate_pair() -> None:
    rm = _rm()
    assert not rm.evaluate("EURUSD", 1, 1.10, 1.11, 10_000, [], RATES).approved
    assert not rm.evaluate("EURUSD", -1, 1.10, 1.09, 10_000, [], RATES).approved
    d = _long(rm, "EURUSD", [OpenRisk("EURUSD", 1, 50.0)])
    assert not d.approved and "already" in d.reasons[-1]


def test_engine_kill_switch_flattens_positions(cfg) -> None:  # type: ignore[no-untyped-def]
    """Force a drawdown kill and check no position survives more than one bar after it, and no new entries."""
    from aai_fx.backtest.engine import BacktestEngine
    from aai_fx.strategies import strategy_from_config

    from .conftest import synth_ohlc

    cfg.risk.kill_switch_drawdown_pct = 1.0  # trips almost immediately
    data = {"EURUSD": synth_ohlc(3000, freq="15min", seed=21), "USDJPY": synth_ohlc(3000, freq="15min", seed=22, p0=150)}
    r = BacktestEngine(cfg, strategy_from_config("session_breakout", cfg)).run(data)
    assert r.kill_switch is not None
    kill_ts = pd.Timestamp(r.kill_switch.split(" at ")[-1])
    assert all(t.entry_ts <= kill_ts for t in r.trades)
    assert all(t.exit_ts <= kill_ts + pd.Timedelta(minutes=30) for t in r.trades)
