"""Two fixture trades so signed return is no longer zero.

The second row is later and lower. This is a fixture, not a capture.
"""
from __future__ import annotations

import json

from .feature_loader import features_from_observations

ROWS = (
    {"last_trade_price": 0.000030, "quote_atoms": 1_000_000, "signed_quote_flow": 0},
    {"last_trade_price": 0.000024, "quote_atoms": 800_000, "signed_quote_flow": -200_000},
)


def two_row() -> dict:
    values = features_from_observations(ROWS, 1)
    if values[0] == 0.0:
        raise RuntimeError("RETURN_STILL_ZERO")
    return {
        "signed_return": values[0],
        "flow_imbalance": values[1],
        "liquidity_change": values[2],
        "distance_to_adverse_band": values[3],
        "classification": "FIXTURE_TWO_ROW",
        "action": "NO_EXECUTION",
    }


if __name__ == "__main__":
    print(json.dumps(two_row(), sort_keys=True))
