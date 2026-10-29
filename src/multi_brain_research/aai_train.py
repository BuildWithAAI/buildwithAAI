"""Train the adverse-move question on the three shapes.

Scratch and prior are scored. No-trade abstains.
Synthetic data cannot hire. Skill stays closed.
"""
from __future__ import annotations

import json

from .control_brains import frozen_prior, no_trade
from .shape_features import features
from .skill_closed import mark


def train(kind: str) -> dict:
    row = features(kind)
    signed = row["price_change"]
    scratch = {"prediction_ppm": 700_000 if signed < -0.3 else 300_000, "source": "brain"}
    prior = frozen_prior((signed, 0.0, 0.0, 0.0))
    abstain = no_trade((signed, 0.0, 0.0, 0.0))
    return {
        "kind": kind,
        "scratch": scratch["prediction_ppm"],
        "prior": prior["prediction_ppm"],
        "no_trade": abstain["prediction_ppm"],
        "hire_allowed": False,
        "reason": "SYNTHETIC_ONLY",
        "skill": mark(None)["skill"],
        "action": "NO_EXECUTION",
    }


def self_check() -> dict:
    body = train("rug")
    if body["hire_allowed"] or body["no_trade"] is not None or body["skill"] != "NOT_ESTABLISHED":
        raise RuntimeError("TRAIN_MISMATCH")
    return {"scratch": body["scratch"], "prior": body["prior"], "skill": body["skill"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
