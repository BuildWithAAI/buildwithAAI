"""agent-guard integration on the live MT5 path (added by Security agent, 2026-11-03)."""
import shutil
from pathlib import Path

import pytest

from aai_fx.execution.mt5_adapter import MT5Broker, MT5NotAvailable, MT5OrderRequest, _load_agent_guard

GUARD = Path("/workspace/agent-guard")
REQ = MT5OrderRequest(pair="EURUSD", side=1, lots=0.1, stop=1.0700, target=1.0900)


@pytest.fixture()
def guard_home(tmp_path, monkeypatch):
    (tmp_path / "config").mkdir()
    (tmp_path / "state").mkdir()
    shutil.copy(GUARD / "config" / "limits.json", tmp_path / "config" / "limits.json")
    monkeypatch.setenv("AGENT_GUARD_HOME", str(tmp_path))
    ag = _load_agent_guard()
    monkeypatch.setattr(ag.killswitch, "PROPAGATE_TO", [])
    return ag


def test_kill_switch_blocks_live_path_before_platform_check(guard_home):
    guard_home.killswitch.engage("test")
    with pytest.raises(guard_home.KillSwitchEngaged):
        MT5Broker(confirm_live=True, dry_run=False).place_order(REQ, confirm_live=True)


def test_kill_off_live_path_unchanged_on_linux(guard_home):
    with pytest.raises(MT5NotAvailable):
        MT5Broker(confirm_live=True, dry_run=False).place_order(REQ, confirm_live=True)


def test_dry_run_unchanged_even_with_kill_switch(guard_home):
    guard_home.killswitch.engage("test")
    out = MT5Broker(confirm_live=True, dry_run=True).place_order(REQ, confirm_live=True)
    assert out["dry_run"] is True


def test_guard_live_limits(guard_home):
    b = MT5Broker(confirm_live=True, dry_run=False)
    assert b.guard_live(guard_home, REQ, 1.08, equity=10_000)["allowed"]
    with pytest.raises(guard_home.RiskLimitViolation):
        b.guard_live(guard_home, MT5OrderRequest(pair="XAUUSD", side=1, lots=0.1, stop=None, target=None), 2000, 10_000)
    with pytest.raises(guard_home.RiskLimitViolation):  # 5 lots EURUSD ~ $540k notional on $10k equity
        b.guard_live(guard_home, MT5OrderRequest(pair="EURUSD", side=1, lots=5, stop=None, target=None), 1.08, 10_000)
    with pytest.raises(guard_home.RiskLimitViolation):
        b.guard_live(guard_home, REQ, 1.08, equity=None)
