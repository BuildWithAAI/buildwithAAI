"""Cooldown.

The same agent cannot hire twice in one pass.
"""
from __future__ import annotations

import json


def once(agent_id: str, seen: set[str]) -> dict:
    if agent_id in seen:
        return {"agent_id": agent_id, "allowed": False, "reason": "COOLDOWN", "action": "NO_EXECUTION"}
    seen.add(agent_id)
    return {"agent_id": agent_id, "allowed": True, "reason": "FIRST", "action": "NO_EXECUTION"}


def self_check() -> dict:
    seen: set[str] = set()
    first = once("agent_a", seen)
    second = once("agent_a", seen)
    if not first["allowed"] or second["allowed"]:
        raise RuntimeError("COOLDOWN_MISMATCH")
    return {"first": first["reason"], "second": second["reason"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
