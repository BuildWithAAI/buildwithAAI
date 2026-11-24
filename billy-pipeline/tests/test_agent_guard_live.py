"""agent-guard on billy's live branch (added by Security agent, 2026-11-03)."""
import shutil
from pathlib import Path

import pytest

from billy.execution import base


def test_live_branch_refused_when_global_kill_on(tmp_path, monkeypatch):
    (tmp_path / "config").mkdir(); (tmp_path / "state").mkdir()
    shutil.copy("/workspace/agent-guard/config/limits.json", tmp_path / "config" / "limits.json")
    monkeypatch.setenv("AGENT_GUARD_HOME", str(tmp_path))
    (tmp_path / "state" / "KILL_SWITCH").write_text('{"reason": "drill"}')
    with pytest.raises(base.LiveTradingDisabled, match="KILL SWITCH"):
        base._require_agent_guard()


def test_live_branch_fails_closed_if_guard_missing(tmp_path, monkeypatch):
    import sys
    monkeypatch.setenv("AGENT_GUARD_PATH", str(tmp_path / "nope"))
    monkeypatch.setitem(sys.modules, "agent_guard", None)
    with pytest.raises(base.LiveTradingDisabled, match="not importable"):
        base._require_agent_guard()
