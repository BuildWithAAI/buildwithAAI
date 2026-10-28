"""Third brain.

The no-trade control abstains. An abstention cannot break consensus alone.
"""
from __future__ import annotations

import json

from .control_brains import no_trade


def third(features: tuple[float, float, float, float]) -> dict:
    body = no_trade(features)
    body["can_break_consensus"] = False
    body["market_skill"] = "NOT_ESTABLISHED"
    return body


def self_check() -> dict:
    body = third((-0.2, -0.2, -0.2, 0.15))
    if body["prediction_ppm"] is not None or body["can_break_consensus"]:
        raise RuntimeError("THIRD_MISMATCH")
    return {"abstained": True, "can_break": False, "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
