"""Cooldown window.

An agent may hire again only after a different agent has hired.
"""
from __future__ import annotations

import json


def allow(agent_id: str, last: str | None) -> dict:
    if last == agent_id:
        return {"allowed": False, "last": last, "reason": "WAIT_FOR_OTHER", "action": "NO_EXECUTION"}
    return {"allowed": True, "last": agent_id, "reason": "WINDOW_OPEN", "action": "NO_EXECUTION"}


def self_check() -> dict:
    first = allow("agent_a", None)
    blocked = allow("agent_a", first["last"])
    opened = allow("agent_b", first["last"])
    if not first["allowed"] or blocked["allowed"] or not opened["allowed"]:
        raise RuntimeError("WINDOW_MISMATCH")
    return {"blocked": blocked["reason"], "opened": opened["reason"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
