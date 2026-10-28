"""Quorum needs two answering brains.

One answer plus two abstentions is refused.
"""
from __future__ import annotations

import json


def need_two(votes: list[dict]) -> dict:
    answering = [vote for vote in votes if vote.get("prediction_ppm") is not None]
    if len(answering) < 2:
        return {"hire_allowed": False, "reason": "NOT_ENOUGH_ANSWERS", "action": "NO_EXECUTION"}
    return {"hire_allowed": True, "reason": "TWO_ANSWERS", "action": "NO_EXECUTION"}


def self_check() -> dict:
    thin = need_two([{"prediction_ppm": 700_000}, {"prediction_ppm": None}, {"prediction_ppm": None}])
    if thin["hire_allowed"]:
        raise RuntimeError("THIN_ALLOWED")
    return thin


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
