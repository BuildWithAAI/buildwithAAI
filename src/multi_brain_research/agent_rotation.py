"""Three agents hire in turn.

A fourth repeat is blocked.
"""
from __future__ import annotations

import json

from .cooldown_window import allow


def rotate() -> dict:
    last = None
    allowed = []
    for agent in ("agent_a", "agent_b", "agent_c", "agent_c"):
        step = allow(agent, last)
        allowed.append(step["allowed"])
        if step["allowed"]:
            last = agent
    if allowed != [True, True, True, False]:
        raise RuntimeError("ROTATION_MISMATCH")
    return {"allowed": allowed, "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(rotate(), sort_keys=True))
