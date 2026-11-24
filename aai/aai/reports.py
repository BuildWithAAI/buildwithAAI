"""Agent report contract (base fields + optional longterm block, from 2040 Future Agent proposal).
Validated with JSON Schema; reports claiming trades were placed, or ideas with risk_pct > 3, are rejected."""
from __future__ import annotations
import json, time
from pathlib import Path
import jsonschema
from . import audit
from .store import Store, dumps

SCHEMA = json.loads((Path(__file__).parent / "schemas" / "agent_report.schema.json").read_text())
_V = jsonschema.Draft202012Validator(SCHEMA)


def validate(report: dict) -> list[str]:
    errs = [f"{'/'.join(map(str, e.path)) or '<root>'}: {e.message}" for e in _V.iter_errors(report)]
    # semantic rule beyond the schema: holdings_source 'none' => all actual weights must be null
    lt = report.get("longterm") or {}
    if lt.get("holdings_source") == "none" and any(w.get("actual_pct") is not None for w in lt.get("weights", [])):
        errs.append("longterm: holdings_source='none' but actual_pct values are present")
    return errs


def ingest(store: Store, report: dict, actor: str | None = None) -> dict:
    errs = validate(report)
    actor = actor or report.get("agent", "unknown")
    if errs:
        audit.record(store, "agent_report_rejected", actor=actor, inputs={"agent": report.get("agent")}, outcome="rejected", reasons=errs[:20])
        return {"ok": False, "errors": errs}
    try:  # agent-guard: reports from other agents are untrusted text; reject on HIGH injection flags
        import sys as _s; _s.path.insert(0, "/workspace/agent-guard")
        from agent_guard import detect_injection, max_severity
        flags = detect_injection(dumps(report))
        worst = max_severity(flags) if flags else None
    except Exception:  # noqa: BLE001  fail closed
        flags, worst = [{"severity": "HIGH", "code": "agent_guard_unavailable"}], "HIGH"
    if worst == "HIGH":
        audit.record(store, "agent_report_rejected", actor=actor, inputs={"agent": report.get("agent")}, outcome="rejected",
                     reasons=["injection:" + f["code"] for f in flags][:20])
        return {"ok": False, "errors": ["untrusted content flagged: " + ",".join(f["code"] for f in flags)]}
    cur = store.execute("INSERT INTO agent_reports(received_at,agent,kind,capital_bucket,generated_at,status_line,report) VALUES(?,?,?,?,?,?,?)",
                        (time.time(), report["agent"], report.get("kind"), report.get("capital_bucket"), report["generated_at"],
                         report["status_line"], dumps(report)))
    audit.record(store, "agent_report_ingested", actor=actor, ref=str(cur.lastrowid), inputs={"agent": report["agent"], "kind": report.get("kind")},
                 outcome="ok", reasons=[report["status_line"]])
    return {"ok": True, "id": cur.lastrowid}
