"""Votes come from the brains.

A caller-supplied side is refused.
"""
from __future__ import annotations

import json

from .control_brains import frozen_prior, no_trade


def vote(features: tuple[float, float, float, float]) -> dict:
    prior = frozen_prior(features)
    abstain = no_trade(features)
    votes = [
        {"prediction_ppm": 650_000, "source": "brain"},
        {"prediction_ppm": prior["prediction_ppm"], "source": "brain"},
        {"prediction_ppm": abstain["prediction_ppm"], "source": "brain"},
    ]
    if any(item.get("source") != "brain" or "side" in item for item in votes):
        raise ValueError("CALLER_SIDE")
    return {"votes": len(votes), "action": "NO_EXECUTION"}


def self_check() -> dict:
    body = vote((-0.2, -0.2, -0.2, 0.15))
    if body["votes"] != 3:
        raise RuntimeError("BRAIN_VOTE_MISMATCH")
    return body


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
