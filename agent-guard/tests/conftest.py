import shutil
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


@pytest.fixture(autouse=True)
def guard_home(tmp_path, monkeypatch):
    (tmp_path / "config").mkdir()
    (tmp_path / "state").mkdir()
    shutil.copy(ROOT / "config" / "limits.json", tmp_path / "config" / "limits.json")
    monkeypatch.setenv("AGENT_GUARD_HOME", str(tmp_path))
    monkeypatch.delenv("AGENT_GUARD_KILL_FILE", raising=False)
    monkeypatch.delenv("AGENT_GUARD_CONFIG", raising=False)
    from agent_guard import killswitch
    monkeypatch.setattr(killswitch, "PROPAGATE_TO", [tmp_path / "proj" / "state" / "KILL"])
    (tmp_path / "proj").mkdir()
    return tmp_path
