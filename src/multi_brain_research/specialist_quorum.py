"""Specialist quorum.

Three brains. Hire only on weighted consensus and no dead veto.
"""
from __future__ import annotations

import json

from .dead_veto import veto
from .weighted_consensus import weigh


def quorum(votes: list[dict], fate: str) -> dict:
    if len(votes) != 3:
        raise ValueError("QUORUM_SIZE")
    weighed = weigh(votes)
    gated = veto(fate, weighed["hire_allowed"])
    return {"hire_allowed": gated["hire_allowed"], "reason": gated["reason"] if fate == "dead" else weighed["reason"], "action": "NO_EXECUTION"}


def self_check() -> dict:
    votes = [
        {"prediction_ppm": 700_000, "verification": 60},
        {"prediction_ppm": 650_000, "verification": 55},
        {"prediction_ppm": None, "verification": 90},
    ]
    live = quorum(votes, "live")
    dead = quorum(votes, "dead")
    if not live["hire_allowed"] or dead["hire_allowed"]:
        raise RuntimeError("QUORUM_MISMATCH")
    return {"live": live["hire_allowed"], "dead": dead["reason"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
