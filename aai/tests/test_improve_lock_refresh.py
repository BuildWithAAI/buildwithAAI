"""improve-lock refresh: a long run extends its own lock; never creates or steals one."""
import json
import time

from aai import improve_lock


def _lock(tmp_path, monkeypatch):
    monkeypatch.setattr(improve_lock, "LOCK", tmp_path / ".improve.lock")
    return improve_lock.LOCK


def test_refresh_extends_own_lock(tmp_path, monkeypatch):
    lock = _lock(tmp_path, monkeypatch)
    a = improve_lock.acquire("run-a", ttl=60)
    r = improve_lock.refresh("run-a", ttl=900)
    assert r["ok"] and r["refreshed"] and not r["was_stale"] and r["refreshes"] == 1
    d = json.loads(lock.read_text())
    assert d["acquired_at"] == a["acquired_at"] and d["expires_at"] >= time.time() + 890 and d["ttl_sec"] == 900
    assert improve_lock.refresh("run-a", ttl=900)["refreshes"] == 2
    # same-owner acquire still says "held" so "exit 3 = stop" stays unambiguous; others are still kept out
    assert not improve_lock.acquire("run-a")["ok"] and not improve_lock.acquire("run-b")["ok"]
    assert improve_lock.release("run-a")["ok"] and not lock.exists()
    assert not list(tmp_path.glob("*.tmp"))


def test_refresh_never_creates_or_steals(tmp_path, monkeypatch):
    lock = _lock(tmp_path, monkeypatch)
    assert improve_lock.refresh("run-a")["reason"] == "not held" and not lock.exists()
    improve_lock.acquire("run-a", ttl=60)
    r = improve_lock.refresh("run-b")
    assert not r["ok"] and "run-a" in r["reason"] and json.loads(lock.read_text())["owner"] == "run-a"


def test_refresh_own_stale_lock_and_cli(tmp_path, monkeypatch):
    lock = _lock(tmp_path, monkeypatch)
    improve_lock.acquire("run-a", ttl=1)
    d = json.loads(lock.read_text()); d["expires_at"] = time.time() - 5; lock.write_text(json.dumps(d))
    r = improve_lock.refresh("run-a", ttl=0)
    assert r["ok"] and r["was_stale"] and r["ttl_sec"] == 1  # ttl clamps to >= 1 s


def test_cli_lists_refresh():
    import subprocess, sys
    from pathlib import Path
    out = subprocess.run([sys.executable, "-m", "aai.cli", "improve-lock", "--help"], capture_output=True, text=True,
                         cwd=Path(__file__).parent.parent).stdout
    assert "refresh" in out
