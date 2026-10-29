"""Council accepts only brain votes.
"""
from __future__ import annotations

import json

from .brain_votes import vote


def accept(votes: list[dict]) -> dict:
    if any(item.get("source") != "brain" for item in votes):
        return {"hire_allowed": False, "reason": "CALLER_SIDE", "action": "NO_EXECUTION"}
    return {"hire_allowed": True, "votes": len(votes), "action": "NO_EXECUTION"}


def self_check() -> dict:
    brains = vote((-0.2, -0.2, -0.2, 0.15))
    bad = accept([{"source": "caller", "prediction_ppm": 1}])
    if brains["votes"] != 3 or bad["hire_allowed"]:
        raise RuntimeError("COUNCIL_SOURCE_MISMATCH")
    return {"brains": brains["votes"], "caller": bad["reason"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
