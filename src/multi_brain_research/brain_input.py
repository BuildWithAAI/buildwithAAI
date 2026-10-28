"""Turn a priced tape row into the four first-brain features.

An account row has no trade, so return, flow, and liquidity are zero.
Distance uses the adverse band already defined. This does not train.
"""
from __future__ import annotations

import json

FEATURE_NAMES = ("signed_return", "flow_imbalance", "liquidity_change", "distance_to_adverse_band")
ADVERSE_BAND = 0.15


def features(row: dict) -> dict:
    price = row.get("price_quote_per_base")
    if type(price) not in (int, float) or price <= 0:
        raise ValueError("NO_PRICE")
    distance = max(0.0, min(1.0, ADVERSE_BAND))
    values = (0.0, 0.0, 0.0, round(distance, 6))
    return {
        "features": dict(zip(FEATURE_NAMES, values)),
        "classification": row.get("classification"),
        "trade": False,
        "action": "NO_EXECUTION",
    }


def self_check() -> dict:
    row = features({"price_quote_per_base": 0.00002796, "classification": "ACCOUNT_DECODE_NOT_A_TRADE"})
    if row["features"]["signed_return"] != 0.0 or row["features"]["distance_to_adverse_band"] != 0.15:
        raise RuntimeError("FEATURE_MISMATCH")
    return {"features": row["features"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
