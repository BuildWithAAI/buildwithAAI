"""Persisted guard-audit result -> agent-guard pipeline chip, and FX desk flip history (pure, tmp paths only)."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from aai import guard_audit
from aai.adapters.registry import build
from aai.hud import create_app
from aai.intel import fxdesk


@pytest.fixture
def client(cfg, store, monkeypatch):
    monkeypatch.delenv("AAI_HUD_TOKEN", raising=False)
    return create_app(cfg, store, build(cfg, store), heavy=False).test_client()


def test_guard_audit_save_load_roundtrip_and_sanitised(tmp_path):
    p = tmp_path / "ga.json"
    rec = guard_audit.save({"status": "timed_out", "rc": None, "elapsed_sec": 240.4, "timeout_sec": 240,
                            "tail": "SECRET-ish output must not persist"}, path=str(p), now=1000.0)
    assert rec["status"] == "timed_out" and "tail" not in json.loads(p.read_text())
    last = guard_audit.load_last(str(p), now=1600.0)
    assert last == {"status": "timed_out", "rc": None, "elapsed_sec": 240.4, "timeout_sec": 240.0,
                    "finished_at": 1000.0, "age_sec": 600,
                    "history": [{"status": "timed_out", "elapsed_sec": 240.4, "finished_at": 1000.0}], "timeout_streak": 1,
                    "findings": None, "findings_prev": None, "findings_delta": None}
    # unknown status is stored as fail; garbage or missing files read as None
    guard_audit.save({"status": "weird", "rc": 2}, path=str(p), now=1.0)
    assert guard_audit.load_last(str(p))["status"] == "fail"
    p.write_text("{not json")
    assert guard_audit.load_last(str(p)) is None
    assert guard_audit.load_last(str(tmp_path / "nope.json")) is None


def test_agent_guard_pipeline_carries_last_audit(client, tmp_path, monkeypatch):
    p = tmp_path / "ga.json"
    monkeypatch.setenv("AAI_GUARD_AUDIT_STATE", str(p))
    assert guard_audit.state_path() == str(p)
    guard_audit.save({"status": "pass", "rc": 0, "elapsed_sec": 12.3, "timeout_sec": 240}, path=str(p))
    ov = client.get("/api/zoora/overview").json
    row = next(r for r in ov["pipelines"] if r["id"] == "agent_guard")
    assert row["guard_audit"]["status"] == "pass" and row["guard_audit"]["elapsed_sec"] == 12.3
    js = Path("aai/static/zoora/zoora.js").read_text()
    assert "p.guard_audit" in js and "AUDIT ${gl}" in js


def test_fx_flips_history_newest_first_and_zero_rule():
    h = [["2026-08-18", 5.0], ["2026-08-25", -3.0], ["2026-09-01", 0.0], ["2026-09-08", 4.0],
         ["2026-09-15", 6.0], ["2026-09-22", -1.5], ["2026-09-29", "bad"], ["2026-10-06", 2.0]]
    f = fxdesk.flips(h)
    assert [x["date"] for x in f] == ["2026-09-22", "2026-08-25"]  # 0 boundaries and malformed weeks are not flips
    assert f[0] == {"date": "2026-09-22", "idx": 5, "to": "short", "from_pct": 6.0, "to_pct": -1.5}
    assert fxdesk.flips([]) == [] and fxdesk.flips([["d", 1.0]]) == []
    many = [[f"2026-01-{i:02d}", (1 if i % 2 else -1) * 3.0] for i in range(1, 12)]
    assert len(fxdesk.flips(many)) == fxdesk.FLIPS_MAX


def test_fx_cot_view_includes_flips_and_ui_hooks():
    row = {"nc_net": -100, "nc_net_chg": 10, "oi": 1000, "nc_index_26w": 40, "report_date": "2026-11-03", "symbol": "6A",
           "nc_hist": [["2026-10-20", 50, 1000], ["2026-10-27", -20, 1000], ["2026-11-03", -100, 1000]]}
    v = fxdesk._cot_view(row, 1)
    assert [x["date"] for x in v["flips_12w"]] == ["2026-10-27"] and v["flips_12w"][0]["to"] == "short"
    js = Path("aai/static/zoora/zoora.js").read_text()
    assert "flips_12w" in js and "fxd-flip" in js


def test_guard_audit_history_ring_buffer_and_streak(tmp_path):
    p = tmp_path / "ga.json"
    # legacy file (no history key) seeds history with its own last run
    p.write_text(json.dumps({"status": "pass", "rc": 0, "elapsed_sec": 9.0, "timeout_sec": 240, "finished_at": 10.0}))
    assert guard_audit.load_last(str(p), now=20.0)["history"] == [{"status": "pass", "elapsed_sec": 9.0, "finished_at": 10.0}]
    for i in range(guard_audit.HISTORY_MAX + 5):
        st = "timed_out" if i >= guard_audit.HISTORY_MAX + 2 else "pass"
        guard_audit.save({"status": st, "elapsed_sec": 240, "timeout_sec": 240, "tail": "x"}, path=str(p), now=100.0 + i)
    raw = json.loads(p.read_text())
    assert len(raw["history"]) == guard_audit.HISTORY_MAX and "tail" not in json.dumps(raw)
    last = guard_audit.load_last(str(p), now=200.0)
    assert last["timeout_streak"] == 3 and last["history"][-1]["finished_at"] == 124.0
    # garbage history entries are dropped, not raised
    raw["history"].append({"status": "evil", "finished_at": "x"})
    p.write_text(json.dumps(raw))
    assert len(guard_audit.load_last(str(p))["history"]) == guard_audit.HISTORY_MAX


def test_guard_audit_staleness_alarm_rules():
    base = {"status": "pass", "finished_at": 1000.0, "timeout_sec": 240.0, "timeout_streak": 0}
    assert guard_audit.staleness_alarm(None) is None
    assert guard_audit.staleness_alarm({**base, "age_sec": 3600}) is None
    a = guard_audit.staleness_alarm({**base, "age_sec": 25 * 3600})
    assert a["sev"] == "warn" and a["id"] == "ga_stale_1000" and a["chime"] is True
    assert guard_audit.staleness_alarm({**base, "status": "timed_out", "age_sec": 60, "timeout_streak": 2}) is None
    b = guard_audit.staleness_alarm({**base, "status": "timed_out", "age_sec": 60, "timeout_streak": 3})
    assert b["id"] == "ga_timeouts_1000" and "3 runs in a row" in b["title"]


def test_guard_audit_timeout_streak_alarm_reaches_overview(client, tmp_path, monkeypatch):
    p = tmp_path / "ga.json"
    monkeypatch.setenv("AAI_GUARD_AUDIT_STATE", str(p))
    for i in range(3):
        guard_audit.save({"status": "timed_out", "elapsed_sec": 240, "timeout_sec": 240}, path=str(p))
    ov = client.get("/api/zoora/overview").json
    assert any(a["id"].startswith("ga_timeouts_") and a["sev"] == "warn" for a in ov["alerts"])
    row = next(r for r in ov["pipelines"] if r["id"] == "agent_guard")
    assert row["guard_audit"]["timeout_streak"] == 3 and len(row["guard_audit"]["history"]) == 3
    js = Path("aai/static/zoora/zoora.js").read_text()
    assert "gaHist(" in js and "ga-trend" in js and "timeout_streak" in js
