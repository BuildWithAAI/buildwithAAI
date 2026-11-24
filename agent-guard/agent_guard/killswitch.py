"""Global kill switch: ONE flag file (state/KILL_SWITCH) that every guarded code path checks.

Fail-closed: if the guard state directory is missing/unreadable, engaged() returns True.
`killswitch on` also propagates to the per-project kill switches that already exist on this box
(aai-forex state/KILL_SWITCH, perps-pipeline state/KILL) and records which files it created, so
`killswitch off` only removes what it created.
"""
from __future__ import annotations

import json
import os
import time
from pathlib import Path

from . import audit_log, paths
from .errors import KillSwitchEngaged

# Existing per-project kill-switch files (found in the audit). Created on `on`, removed on `off`
# only if agent-guard created them.
PROPAGATE_TO = [
    Path("/workspace/aai-forex/state/KILL_SWITCH"),
    Path("/workspace/perps-pipeline/state/KILL"),
]
PROPAGATED_RECORD = "killswitch_propagated.json"


def status() -> dict:
    kf = paths.kill_file()
    sd = kf.parent
    if not sd.is_dir() or not os.access(sd, os.R_OK):
        return {"engaged": True, "reason": f"guard state dir missing/unreadable ({sd}) - fail closed", "file": str(kf)}
    if kf.exists():
        try:
            info = json.loads(kf.read_text() or "{}")
        except (ValueError, OSError):
            info = {"reason": "flag file present (unparseable)"}
        return {"engaged": True, "file": str(kf), **info}
    return {"engaged": False, "file": str(kf)}


def engaged() -> bool:
    try:
        return bool(status()["engaged"])
    except Exception:  # noqa: BLE001 - any error => fail closed
        return True


def require_not_engaged(agent: str = "unknown", action: str = "act") -> None:
    st = status()
    if st["engaged"]:
        audit_log.append("kill_switch_block", agent, {"action": action, "reason": st.get("reason")}, outcome="denied")
        raise KillSwitchEngaged(f"GLOBAL KILL SWITCH engaged ({st.get('reason')}); refusing to {action}")


def engage(reason: str, actor: str = "human", propagate: bool = True) -> dict:
    kf = paths.kill_file()
    kf.parent.mkdir(parents=True, exist_ok=True)
    info = {"reason": reason, "by": actor, "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    tmp = kf.with_suffix(".tmp")
    tmp.write_text(json.dumps(info))
    os.chmod(tmp, 0o644)
    os.replace(tmp, kf)
    created = []
    if propagate:
        for p in PROPAGATE_TO:
            try:
                if p.parent.parent.is_dir() and not p.exists():
                    p.parent.mkdir(parents=True, exist_ok=True)
                    p.write_text(json.dumps({"reason": f"agent-guard global kill: {reason}", "at": info["at"]}))
                    created.append(str(p))
            except OSError:
                pass
        rec = kf.parent / PROPAGATED_RECORD
        prev = json.loads(rec.read_text()) if rec.exists() else []
        rec.write_text(json.dumps(sorted(set(prev + created))))
    audit_log.append("kill_switch", actor, {"on": True, "reason": reason, "propagated": created})
    return {**status(), "propagated": created}


def release(reason: str, actor: str = "human") -> dict:
    kf = paths.kill_file()
    removed = []
    rec = kf.parent / PROPAGATED_RECORD
    if rec.exists():
        for p in json.loads(rec.read_text() or "[]"):
            try:
                Path(p).unlink()
                removed.append(p)
            except FileNotFoundError:
                pass
        rec.unlink()
    if kf.exists():
        kf.unlink()
    audit_log.append("kill_switch", actor, {"on": False, "reason": reason, "removed_propagated": removed})
    return {**status(), "removed_propagated": removed}
