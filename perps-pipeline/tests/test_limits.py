import pandas as pd

from perps.config import RiskCfg
from perps.risk.limits import RiskManager


def test_daily_loss_limit_blocks_until_next_day():
    rm = RiskManager(RiskCfg(daily_loss_limit=0.05), 100.0)
    rm.on_equity(pd.Timestamp("2025-01-01 00:00", tz="UTC"), 100.0)
    assert rm.can_open(96.0, 0)[0]
    ok, why = rm.can_open(95.0, 0)
    assert not ok and why == "daily loss limit"
    rm.on_equity(pd.Timestamp("2025-01-02 00:00", tz="UTC"), 95.0)
    assert rm.can_open(95.0, 0)[0]


def test_max_concurrent_positions():
    rm = RiskManager(RiskCfg(max_concurrent_positions=2), 100.0)
    assert rm.can_open(100, 1)[0]
    assert rm.can_open(100, 2) == (False, "max concurrent positions")


def test_drawdown_kill_switch_is_sticky():
    rm = RiskManager(RiskCfg(max_drawdown_kill=0.2, daily_loss_limit=0.99), 100.0)
    rm.on_equity(pd.Timestamp("2025-01-01", tz="UTC"), 120.0)
    rm.on_equity(pd.Timestamp("2025-01-05", tz="UTC"), 95.0)  # 20.8% below peak
    assert rm.state.killed
    rm.on_equity(pd.Timestamp("2025-01-06", tz="UTC"), 130.0)
    assert rm.can_open(130, 0) == (False, "drawdown kill switch")


def test_manual_kill_switch_flag_and_file(tmp_path):
    assert RiskManager(RiskCfg(kill_switch=True), 100).can_open(100, 0) == (False, "manual kill switch")
    f = tmp_path / "KILL"
    rm = RiskManager(RiskCfg(), 100, kill_file=f)
    assert rm.can_open(100, 0)[0]
    f.write_text("stop")
    assert rm.can_open(100, 0) == (False, "manual kill switch")
