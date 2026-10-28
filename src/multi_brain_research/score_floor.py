"""A malicious score cannot rise without a new receipt.
"""
from __future__ import annotations

import json


def raise_score(score: int, new_receipt: bool) -> dict:
    if score == 0 and not new_receipt:
        return {"score": 0, "reason": "NO_RECEIPT", "action": "NO_EXECUTION"}
    return {"score": score + 1 if new_receipt else score, "action": "NO_EXECUTION"}


def self_check() -> dict:
    stuck = raise_score(0, False)
    if stuck["score"]:
        raise RuntimeError("SCORE_ROSE")
    return stuck


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
