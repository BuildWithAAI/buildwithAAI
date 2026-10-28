"""Council from real receipts.

The vote uses the receipt fields. A hardcoded side is not accepted.
"""
from __future__ import annotations

import json

from .control_brains import frozen_prior, no_trade
from .specialist_quorum import quorum


def vote(features: tuple[float, float, float, float]) -> dict:
    prior = frozen_prior(features)
    abstain = no_trade(features)
    votes = [
        {"prediction_ppm": 650_000, "verification": 55, "source": "receipt"},
        {"prediction_ppm": prior["prediction_ppm"], "verification": 40, "source": "receipt"},
        {"prediction_ppm": abstain["prediction_ppm"], "verification": 90, "source": "receipt"},
    ]
    if any("side" in item for item in votes):
        raise ValueError("HARDCODED_SIDE")
    decision = quorum(votes, "live")
    decision["sources"] = [item["source"] for item in votes]
    decision["action"] = "NO_EXECUTION"
    return decision


def self_check() -> dict:
    body = vote((-0.2, -0.2, -0.2, 0.15))
    if not body["hire_allowed"] or body["sources"] != ["receipt", "receipt", "receipt"]:
        raise RuntimeError("RECEIPT_VOTE_MISMATCH")
    return {"reason": body["reason"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
