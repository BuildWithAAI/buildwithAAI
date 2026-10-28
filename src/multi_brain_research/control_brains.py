"""Two control brains. Same receipt shape as the first brain. No orders.

no_trade always abstains.
frozen_prior uses a fixed rule on the signed return already in the features.
It is not FlyVis and it is not a market claim.
"""
from __future__ import annotations

import hashlib
import json

MODULE_NO_TRADE = "no_trade_control_v1"
MODULE_PRIOR = "frozen_prior_control_v1"
SOURCE = "research_joint"
HORIZON_MS = 300_000
TASK_SHA = hashlib.sha256(b"adverse_move_after_fee_v1").hexdigest()
MODEL_SHA = hashlib.sha256(b"frozen_prior_v1").hexdigest()
GRAPH_SHA = "a" * 64


def _receipt(module_id: str, prediction: int | None, uncertainty: int | None, reason: str | None) -> dict:
    return {
        "module_id": module_id,
        "source_id": SOURCE,
        "graph_sha256": GRAPH_SHA,
        "model_sha256": MODEL_SHA,
        "task_sha256": TASK_SHA,
        "horizon_ms": HORIZON_MS,
        "prediction_ppm": prediction,
        "uncertainty_ppm": uncertainty,
        "abstain_reason": reason,
        "action": "NO_EXECUTION",
        "execution_allowed": False,
    }


def no_trade(_: tuple[float, float, float, float]) -> dict:
    return _receipt(MODULE_NO_TRADE, None, None, "UNCALIBRATED")


def frozen_prior(features: tuple[float, float, float, float]) -> dict:
    signed = features[0]
    if abs(signed) < 0.05:
        return _receipt(MODULE_PRIOR, None, None, "UNCALIBRATED")
    probability = 0.7 if signed < 0 else 0.3
    return _receipt(MODULE_PRIOR, int(probability * 1_000_000), int(abs(probability - 0.5) * 1_000_000), None)


def self_check() -> dict:
    quiet = no_trade((0.0, 0.0, 0.0, 0.15))
    prior = frozen_prior((-0.2, 0.1, -0.1, 0.15))
    if quiet["prediction_ppm"] is not None or prior["action"] != "NO_EXECUTION":
        raise RuntimeError("CONTROL_LEAK")
    return {"no_trade": quiet["abstain_reason"], "prior_ppm": prior["prediction_ppm"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
