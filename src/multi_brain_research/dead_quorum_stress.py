"""Ten dead coins through the quorum.

All refused.
"""
from __future__ import annotations

import json

from .specialist_quorum import quorum


def run() -> dict:
    votes = [
        {"prediction_ppm": 700_000, "verification": 60},
        {"prediction_ppm": 650_000, "verification": 55},
        {"prediction_ppm": None, "verification": 90},
    ]
    refused = sum(1 for _ in range(10) if not quorum(votes, "dead")["hire_allowed"])
    if refused != 10:
        raise RuntimeError("DEAD_STRESS_MISMATCH")
    return {"coins": 10, "refused": refused, "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(run(), sort_keys=True))
