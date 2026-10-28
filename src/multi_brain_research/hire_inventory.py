"""Inventory gate on the hire.

The curve vault cannot post the fee.
"""
from __future__ import annotations

import json

from .gated_router import route_if_held
from .inventory_gate import CURVE


def gate_hire(admission: dict, wallet: str, held_days: int, atoms: int) -> dict:
    return route_if_held(admission, 1_000_000, wallet, held_days, atoms)


def self_check() -> dict:
    admission = {
        "request_id": "req_receipt",
        "status": "ADMITTED",
        "admitted": "fly_hemibrain_adverse_v1",
        "action": "NO_EXECUTION",
    }
    refused = gate_hire(admission, CURVE, 90, 10**12)
    if refused["fee_status"] != "UNPAID":
        raise RuntimeError("VAULT_PAID")
    return {"vault": refused["status"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
