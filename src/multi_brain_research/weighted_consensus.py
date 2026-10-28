"""Weighted consensus.

Verification outweighs a louder prediction. An abstention has no weight.
"""
from __future__ import annotations

import json


def weigh(votes: list[dict]) -> dict:
    adverse = other = 0
    for vote in votes:
        if vote.get("prediction_ppm") is None:
            continue
        weight = vote["verification"]
        if vote["prediction_ppm"] >= 500_000:
            adverse += weight
        else:
            other += weight
    if adverse == other == 0:
        return {"hire_allowed": False, "reason": "NO_WEIGHT", "action": "NO_EXECUTION"}
    allowed = adverse > other
    return {"hire_allowed": allowed, "adverse": adverse, "other": other, "reason": "WEIGHTED", "action": "NO_EXECUTION"}


def self_check() -> dict:
    loud_low = weigh([
        {"prediction_ppm": 900_000, "verification": 10},
        {"prediction_ppm": 200_000, "verification": 70},
    ])
    if loud_low["hire_allowed"]:
        raise RuntimeError("LOUD_WON")
    return {"loud_low": loud_low["hire_allowed"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
