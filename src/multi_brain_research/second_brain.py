"""Second brain on the same row.

Uses the frozen prior. Abstains only if it has no rule.
"""
from __future__ import annotations

import json

from .control_brains import frozen_prior
from .two_row_return import two_row


def second() -> dict:
    row = two_row()
    body = frozen_prior((row["signed_return"], row["flow_imbalance"], row["liquidity_change"], row["distance_to_adverse_band"]))
    body["market_skill"] = "NOT_ESTABLISHED"
    return body


def self_check() -> dict:
    body = second()
    if body["prediction_ppm"] is None:
        raise RuntimeError("SECOND_ABSTAINED")
    return {"module": body["module_id"], "prediction_ppm": body["prediction_ppm"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
