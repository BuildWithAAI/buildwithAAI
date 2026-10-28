"""Three-way score on one fixture.

Scratch, frozen prior, and no-trade. No-trade abstains.
"""
from __future__ import annotations

import json

from .control_brains import frozen_prior, no_trade
from .two_row_return import two_row


def score() -> dict:
    row = two_row()
    values = (row["signed_return"], row["flow_imbalance"], row["liquidity_change"], row["distance_to_adverse_band"])
    return {
        "scratch": {"prediction_ppm": 598_687, "source": "CALIBRATED_FIXTURE"},
        "prior": frozen_prior(values)["prediction_ppm"],
        "no_trade": no_trade(values)["prediction_ppm"],
        "market_skill": "NOT_ESTABLISHED",
        "action": "NO_EXECUTION",
    }


def self_check() -> dict:
    body = score()
    if body["no_trade"] is not None or body["prior"] is None:
        raise RuntimeError("THREE_WAY_MISMATCH")
    return body


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
