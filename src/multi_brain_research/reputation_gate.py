"""Verification with decay. A low score blocks a hire. It never holds funds.

Score is parts per hundred. Decay is applied per completed epoch, not per block.
"""
from __future__ import annotations

import json


class GateError(ValueError):
    pass


def decay(score: int, epochs: int, rate_ppm: int = 50_000) -> int:
    if type(score) is not int or not 0 <= score <= 100:
        raise GateError("BAD_SCORE")
    if type(epochs) is not int or epochs < 0 or type(rate_ppm) is not int or not 0 <= rate_ppm <= 1_000_000:
        raise GateError("BAD_DECAY")
    value = score
    keep = 1_000_000 - rate_ppm
    for _ in range(epochs):
        value = (value * keep) // 1_000_000
    return value


def gate(score: int, floor: int) -> dict:
    if type(floor) is not int or not 0 <= floor <= 100:
        raise GateError("BAD_FLOOR")
    allowed = score >= floor
    return {
        "score": score,
        "floor": floor,
        "hire_allowed": allowed,
        "reason": "ABOVE_FLOOR" if allowed else "BELOW_FLOOR",
        "funds_held": False,
        "action": "NO_EXECUTION",
    }


def penalize(score: int, points: int) -> int:
    if type(points) is not int or points < 0:
        raise GateError("BAD_PENALTY")
    return max(0, score - points)


def self_check() -> dict:
    aged = decay(80, 2)
    blocked = gate(aged, 70)
    if blocked["funds_held"] or blocked["hire_allowed"]:
        raise GateError("GATE_MISMATCH")
    return {"aged": aged, "reason": blocked["reason"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
