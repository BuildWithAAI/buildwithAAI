"""Skill stays closed.

No brain is skilled until a tape shows an edge. Until then, not established.
"""
from __future__ import annotations

import json

SKILL = "NOT_ESTABLISHED"


def mark(edge: float | None) -> dict:
    if edge is None or edge <= 0:
        return {"skill": SKILL, "action": "NO_EXECUTION"}
    return {"skill": SKILL, "reason": "EDGE_NOT_ENOUGH", "action": "NO_EXECUTION"}


def self_check() -> dict:
    body = mark(0.2)
    if body["skill"] != SKILL:
        raise RuntimeError("SKILL_OPENED")
    return body


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
