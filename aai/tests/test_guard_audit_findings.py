"""Guard-audit findings counts over time: only the four summary integers are taken from the audit output."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

from aai import guard_audit
from aai.adapters.registry import build
from aai.hud import create_app


@pytest.fixture
def client(cfg, store, monkeypatch):
    monkeypatch.delenv("AAI_HUD_TOKEN", raising=False)
    return create_app(cfg, store, build(cfg, store), heavy=False).test_client()


def test_parse_summary_strict():
    ok = "# agent-guard audit x\n\nSummary: {'CRITICAL': 5, 'HIGH': 9, 'MEDIUM': 1, 'LOW': 30}\n\nKill switch: off"
    assert guard_audit.parse_summary(ok) == {"CRITICAL": 5, "HIGH": 9, "MEDIUM": 1, "LOW": 30}
    assert guard_audit.parse_summary(ok.encode()) == {"CRITICAL": 5, "HIGH": 9, "MEDIUM": 1, "LOW": 30}
    assert guard_audit.parse_summary("no summary here") is None
    assert guard_audit.parse_summary(None) is None
    assert guard_audit.parse_summary("  Summary: {'CRITICAL': 5, 'HIGH': 9, 'MEDIUM': 1, 'LOW': 0}") is None  # not anchored
    assert guard_audit.parse_summary("Summary: {'CRITICAL': -1, 'HIGH': 9, 'MEDIUM': 1, 'LOW': 0}") is None
    assert guard_audit.parse_summary(ok + "\n" + ok) is None  # ambiguous -> record nothing


def test_run_records_findings(tmp_path):
    s = tmp_path / "a.py"
    s.write_text("import sys\nprint('# t')\nprint(\"Summary: {'CRITICAL': 2, 'HIGH': 3, 'MEDIUM': 0, 'LOW': 1}\")\n"
                 + "print('x\\n'*50)\nsys.exit(2)\n")
    r = guard_audit.run(str(s), timeout=30, python=sys.executable)
    assert r["status"] == "fail" and r["findings"] == {"CRITICAL": 2, "HIGH": 3, "MEDIUM": 0, "LOW": 1}
    assert "Summary" not in r["tail"]  # summary sits above the tail; counts come from the full output


def test_findings_history_delta_and_alarm(tmp_path):
    p = str(tmp_path / "ga.json")
    guard_audit.save({"status": "timed_out", "elapsed_sec": 240, "findings": {"CRITICAL": 1, "HIGH": 1, "MEDIUM": 0, "LOW": 0}},
                     path=p, now=1000)  # timed-out runs never carry counts
    last = guard_audit.load_last(p, now=1001)
    assert last["findings"] is None and "findings" not in last["history"][0]
    assert guard_audit.findings_alarm(last) is None
    guard_audit.save({"status": "fail", "rc": 2, "findings": {"CRITICAL": 5, "HIGH": 9, "MEDIUM": 1, "LOW": 0}}, path=p, now=2000)
    guard_audit.save({"status": "fail", "rc": 2, "findings": {"CRITICAL": "x", "HIGH": 1}}, path=p, now=2500)  # garbage dropped
    last = guard_audit.load_last(p, now=2600)
    assert last["findings"]["CRITICAL"] == 5 and last["findings_delta"] is None and guard_audit.findings_alarm(last) is None
    guard_audit.save({"status": "fail", "rc": 2, "findings": {"CRITICAL": 4, "HIGH": 9, "MEDIUM": 0, "LOW": 0}}, path=p, now=3000)
    last = guard_audit.load_last(p, now=3001)
    assert last["findings_delta"] == {"CRITICAL": -1, "HIGH": 0, "MEDIUM": -1, "LOW": 0}
    assert guard_audit.findings_alarm(last) is None  # shrinking: no alarm
    guard_audit.save({"status": "fail", "rc": 2, "findings": {"CRITICAL": 4, "HIGH": 11, "MEDIUM": 0, "LOW": 0}}, path=p, now=4000)
    a = guard_audit.findings_alarm(guard_audit.load_last(p, now=4001))
    assert a["id"] == "ga_findings_up_4000" and a["sev"] == "warn" and a["chime"] and "HIGH 9→11" in a["detail"]
    assert len(guard_audit.load_last(p)["history"]) == 5


def test_findings_reach_overview_and_ui(client, tmp_path, monkeypatch):
    p = tmp_path / "ga.json"
    monkeypatch.setenv("AAI_GUARD_AUDIT_STATE", str(p))
    guard_audit.save({"status": "fail", "rc": 2, "findings": {"CRITICAL": 5, "HIGH": 9, "MEDIUM": 1, "LOW": 0}}, path=str(p))
    guard_audit.save({"status": "fail", "rc": 2, "findings": {"CRITICAL": 6, "HIGH": 9, "MEDIUM": 1, "LOW": 0}}, path=str(p))
    ov = client.get("/api/zoora/overview").json
    row = next(r for r in ov["pipelines"] if r["id"] == "agent_guard")
    assert row["guard_audit"]["findings"]["CRITICAL"] == 6 and row["guard_audit"]["findings_delta"]["CRITICAL"] == 1
    assert any(a["id"].startswith("ga_findings_up_") for a in ov["alerts"])
    js = Path("aai/static/zoora/zoora.js").read_text()
    assert "gaFind(" in js and "ga-find" in js and "findings_delta" in js
