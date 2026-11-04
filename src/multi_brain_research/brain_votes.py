"""Votes come from the brains.

The market ballot is the tape heuristic. The other two ballots are the
existing frozen-prior and no-trade controls. A caller-supplied side is refused.
"""
from __future__ import annotations

import json
import math

from .brain_input import FEATURE_NAMES, paper_long_support
from .control_brains import MODULE_NO_TRADE, MODULE_PRIOR, frozen_prior, no_trade


def vote(features: tuple[float, float, float, float]) -> dict:
    if type(features) is not tuple or len(features) != 4:
        raise ValueError("BAD_FEATURES")
    if any(type(value) is bool or type(value) not in (int, float) or not math.isfinite(float(value)) for value in features):
        raise ValueError("BAD_FEATURES")
    mapped = {"features": dict(zip(FEATURE_NAMES, (float(value) for value in features)))}
    scored = paper_long_support(mapped)
    prior = frozen_prior(features)
    abstain = no_trade(features)
    ballots = [
        {
            "prediction_ppm": scored["prediction_ppm"],
            "uncertainty_ppm": scored["uncertainty_ppm"],
            "source": "brain",
            "module": "tape_heuristic_v1",
        },
        {"prediction_ppm": prior["prediction_ppm"], "source": "brain", "module": MODULE_PRIOR},
        {"prediction_ppm": abstain["prediction_ppm"], "source": "brain", "module": MODULE_NO_TRADE},
    ]
    if any(item.get("source") != "brain" or "side" in item for item in ballots):
        raise ValueError("CALLER_SIDE")
    return {"votes": len(ballots), "ballots": ballots, "action": "NO_EXECUTION"}


def self_check() -> dict:
    down = vote((-0.2, -0.2, -0.2, 0.15))
    up = vote((0.4, 0.5, 0.2, 0.8))
    if down["votes"] != 3 or up["ballots"][0]["prediction_ppm"] <= down["ballots"][0]["prediction_ppm"]:
        raise RuntimeError("BRAIN_VOTE_MISMATCH")
    if down["ballots"][0]["prediction_ppm"] == 650_000 and up["ballots"][0]["prediction_ppm"] == 650_000:
        raise RuntimeError("FIXED_BRAIN_VOTE")
    return down


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
