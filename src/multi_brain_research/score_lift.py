"""A new receipt can lift a malicious score by 1, not more.
"""
from __future__ import annotations

import json


def lift(score: int, receipts: int) -> dict:
    if receipts < 1:
        return {"score": score, "reason": "NO_RECEIPT", "action": "NO_EXECUTION"}
    return {"score": score + 1, "reason": "ONE_STEP", "action": "NO_EXECUTION"}


def self_check() -> dict:
    body = lift(0, 3)
    if body["score"] != 1:
        raise RuntimeError("LIFTED_TOO_FAR")
    return body


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
