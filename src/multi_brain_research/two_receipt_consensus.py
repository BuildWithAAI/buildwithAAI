"""Consensus of two receipts before a hire.

Disagree means no hire. Agree means the hire may proceed.
"""
from __future__ import annotations

import json


def consensus(first: dict, second: dict) -> dict:
    a, b = first.get("prediction_ppm"), second.get("prediction_ppm")
    if a is None or b is None:
        agreed = False
        reason = "ABSTAIN"
    else:
        agreed = (a >= 500_000) == (b >= 500_000)
        reason = "AGREE" if agreed else "DISAGREE"
    return {"agreed": agreed, "reason": reason, "hire_allowed": agreed, "action": "NO_EXECUTION"}


def self_check() -> dict:
    yes = consensus({"prediction_ppm": 600_000}, {"prediction_ppm": 700_000})
    no = consensus({"prediction_ppm": 600_000}, {"prediction_ppm": 300_000})
    if not yes["hire_allowed"] or no["hire_allowed"]:
        raise RuntimeError("CONSENSUS_MISMATCH")
    return {"agree": yes["reason"], "disagree": no["reason"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
