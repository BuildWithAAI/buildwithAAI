"""agent-guard global kill switch in RiskManager (added by Security agent, 2026-11-03)."""
from perps.config import RiskCfg
from perps.risk.limits import RiskManager


def test_global_kill_applies_only_where_kill_file_is_honoured(tmp_path, monkeypatch):
    g = tmp_path / "GLOBAL"
    monkeypatch.setenv("AGENT_GUARD_KILL_FILE", str(g))
    paper = RiskManager(RiskCfg(), 1000.0, kill_file=tmp_path / "KILL")
    backtest = RiskManager(RiskCfg(), 1000.0, kill_file=None)
    assert paper.can_open(1000.0, 0)[0]
    g.write_text("{}")
    assert paper.can_open(1000.0, 0) == (False, "manual kill switch")
    assert backtest.can_open(1000.0, 0)[0]
