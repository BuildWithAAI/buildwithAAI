"""Ten agents through consensus.

A disagreement stays unpaid.
"""
from __future__ import annotations

import json

from .weighted_consensus import weigh


def stress() -> dict:
    unpaid = 0
    for index in range(10):
        votes = [
            {"prediction_ppm": 700_000, "verification": 60},
            {"prediction_ppm": 200_000 if index % 2 else 650_000, "verification": 60},
        ]
        result = weigh(votes)
        if not result["hire_allowed"]:
            unpaid += 1
    if unpaid != 5:
        raise RuntimeError("STRESS_MISMATCH")
    return {"agents": 10, "unpaid": unpaid, "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(stress(), sort_keys=True))
