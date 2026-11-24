"""One-click HUD agent-guard audit: bounded background runner, one in flight, cooldown, typed state only (tmp paths)."""
from __future__ import annotations

import threading
from pathlib import Path

import pytest

from aai import guard_audit
from aai.adapters.registry import build
from aai.hud import create_app


@pytest.fixture
def client(cfg, store, monkeypatch, tmp_path):
    monkeypatch.delenv("AAI_HUD_TOKEN", raising=False)
    monkeypatch.setenv("AAI_GUARD_AUDIT_STATE", str(tmp_path / "ga.json"))
    return create_app(cfg, store, build(cfg, store), heavy=False).test_client()


def test_background_audit_single_flight_cooldown_and_save(tmp_path):
    gate, saved = threading.Event(), []
    def runner():
        gate.wait(5)
        return {"status": "pass", "rc": 0, "elapsed_sec": 1.0, "timeout_sec": 240, "tail": "SECRET OUTPUT"}
    ba = guard_audit.BackgroundAudit(runner=runner, saver=lambda r: saved.append(r), cooldown=300)
    assert ba.start(now=1000)["started"] is True
    assert ba.state()["running"] is True
    second = ba.start(now=1001)
    assert second == {"started": False, "reason": "already running"}
    gate.set(); ba.join(5)
    st = ba.state(now=1060)
    assert st["running"] is False and st["cooldown_sec"] == 240 and st["error"] is None
    assert saved and saved[0]["status"] == "pass"
    assert ba.start(now=1100)["started"] is False and "cooldown" in ba.start(now=1100)["reason"]
    assert ba.start(now=1301)["started"] is True; ba.join(5)


def test_background_audit_crash_is_typed_not_raised():
    def boom():
        raise RuntimeError("leak me /secret/path")
    ba = guard_audit.BackgroundAudit(runner=boom, saver=lambda r: None, cooldown=0)
    ba.start(); ba.join(5)
    assert ba.state()["error"] == "RuntimeError" and ba.state()["running"] is False


def test_hud_guard_audit_run_endpoint_and_row(client, monkeypatch, tmp_path):
    gate = threading.Event()
    def fake_run(script=guard_audit.DEFAULT_SCRIPT, timeout=240, python="python3"):
        gate.wait(5)
        return {"status": "fail", "rc": 2, "elapsed_sec": 3.0, "timeout_sec": timeout,
                "findings": {"CRITICAL": 1, "HIGH": 2, "MEDIUM": 0, "LOW": 0}, "tail": "x"}
    monkeypatch.setattr(guard_audit, "run", fake_run)  # never runs Security's real audit.py in tests
    r = client.post("/api/zoora/guard-audit/run", json={})
    assert r.status_code == 202 and r.json["started"] is True and r.json["running"] is True
    assert client.post("/api/zoora/guard-audit/run", json={}).status_code == 429
    row = next(p for p in client.get("/api/zoora/overview").json["pipelines"] if p["id"] == "agent_guard")
    assert row["guard_audit_run"]["running"] is True
    gate.set()
    client.application  # noqa: B018
    import time
    deadline = time.monotonic() + 15  # time-based, not 50 x 0.05 s: a loaded shared box made the fixed budget flaky
    while True:
        g = client.get("/api/zoora/guard-audit").json
        if not g["run"]["running"] or time.monotonic() > deadline:
            break
        time.sleep(0.05)
    assert g["run"]["running"] is False and g["run"]["error"] is None, g
    assert g["last"] is not None, (g, list(tmp_path.iterdir()) if tmp_path.exists() else "tmp_path removed")
    assert g["last"]["status"] == "fail" and g["last"]["findings"]["HIGH"] == 2
    assert "tail" not in g["last"] and (tmp_path / "ga.json").exists()
    bad = client.post("/api/zoora/guard-audit/run", json={}, headers={"Origin": "http://evil.example"})
    assert bad.status_code == 403
    js = Path("aai/static/zoora/zoora.js").read_text()
    assert "/api/zoora/guard-audit/run" in js and "RUN AUDIT" in js and "guard_audit_run" in js


def test_hud_guard_audit_run_requires_token(client, monkeypatch):
    monkeypatch.setenv("AAI_HUD_TOKEN", "s3cret")
    monkeypatch.setattr(guard_audit, "run", lambda **k: {"status": "pass", "rc": 0, "elapsed_sec": 0.1, "timeout_sec": 240})
    assert client.post("/api/zoora/guard-audit/run", json={}).status_code == 401
    r = client.post("/api/zoora/guard-audit/run", json={}, headers={"X-AAI-Token": "s3cret"})
    assert r.status_code == 202 and r.json["started"] is True
    assert client.get("/api/zoora/guard-audit").status_code == 401
    assert client.get("/api/zoora/guard-audit", headers={"X-AAI-Token": "s3cret"}).status_code == 200

