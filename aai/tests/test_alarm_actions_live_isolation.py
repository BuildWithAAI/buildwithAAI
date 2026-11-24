"""Stale/timing-out guard-audit alarms offer RUN AUDIT in the alarm card; tests never see the live HUD record."""
from pathlib import Path

import pytest

from aai import guard_audit, health, runtime
from aai.adapters.registry import build
from aai.hud import create_app


@pytest.fixture
def client(cfg, store, monkeypatch):
    monkeypatch.delenv("AAI_HUD_TOKEN", raising=False)
    return create_app(cfg, store, build(cfg, store), heavy=False).test_client()


def test_stale_and_timeout_alarms_carry_run_action_findings_does_not():
    base = {"status": "pass", "finished_at": 1000.0, "timeout_sec": 240.0, "timeout_streak": 0}
    assert guard_audit.staleness_alarm({**base, "age_sec": 25 * 3600})["action"] == "guard_audit_run"
    t = guard_audit.staleness_alarm({**base, "status": "timed_out", "age_sec": 60, "timeout_streak": 3})
    assert t["action"] == guard_audit.ALARM_ACTION == "guard_audit_run"


def test_timeout_alarm_action_reaches_overview_with_runner_state(client, tmp_path, monkeypatch):
    p = tmp_path / "ga.json"
    monkeypatch.setenv("AAI_GUARD_AUDIT_STATE", str(p))
    for _ in range(3):
        guard_audit.save({"status": "timed_out", "elapsed_sec": 240, "timeout_sec": 240}, path=str(p))
    ov = client.get("/api/zoora/overview").json
    a = next(a for a in ov["alerts"] if a["id"].startswith("ga_timeouts_"))
    assert a["action"] == "guard_audit_run"
    row = next(r for r in ov["pipelines"] if r["id"] == "agent_guard")
    assert isinstance(row.get("guard_audit_run"), dict)  # the card button reads the same runner state


def test_alarm_card_button_only_offers_never_autostarts():
    js = Path("aai/static/zoora/zoora.js").read_text()
    assert "a.action === 'guard_audit_run'" in js and "al-act" in js
    assert js.count("api('/api/zoora/guard-audit/run'") == 1  # one shared, click-only call site
    i = js.index("async function runGuardAudit(")
    assert "api('/api/zoora/guard-audit/run'" in js[i:i + 400]


def test_tests_never_see_live_hud_record(tmp_path, cfg, store):
    assert runtime.PATH == tmp_path / "hud.json" and runtime.read_hud() is None
    rep = health.run(cfg, store, network=False)
    live = next(c for c in rep["checks"] if c["check"] == "zoora_live_hud")
    assert "not_running" in str(live) and "57025" not in str(live)
