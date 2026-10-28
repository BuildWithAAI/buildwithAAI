"""Curve tape for Anything AI only.

One curve event becomes one tape row. Any other mint is refused.
A missing field is omitted, not stored as zero.
"""
from __future__ import annotations

import json

from .curve_decoder import decode_curve_event

TOKEN = "27RP3fkHt6T2QpCzsrJjk9oMZXAP5cya77VaR3UMpump"
CURVE = "Eq93BkkDVBLkjgHxZU6qVk7hrnzTnAyVfCNrXCVix1PL"


def to_tape(event: dict) -> dict | None:
    if event.get("mint") != TOKEN or event.get("curve_account") != CURVE:
        return None
    decoded = decode_curve_event(event)
    return {
        "mint": TOKEN,
        "curve": CURVE,
        "slot": event["slot"],
        "signature": event["signature"],
        "status": decoded["classification"],
        "action": "NO_EXECUTION",
    }


def self_check() -> dict:
    good = to_tape({
        "mint": TOKEN,
        "curve_account": CURVE,
        "virtual_reserves": {"base": 1_000_000, "quote": 1_000},
        "real_reserves": {"base": 1, "quote": 1},
        "fee_bps": 100,
        "slot": 1,
        "signature": "sig",
    })
    other = to_tape({"mint": "4YfDqzLR2NRLcx4V4VEuhjN2Z1BS3T1aokwNQygDpump", "curve_account": CURVE})
    if not good or other is not None:
        raise RuntimeError("TAPE_MISMATCH")
    return {"kept": 1, "refused_other_mint": True, "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
