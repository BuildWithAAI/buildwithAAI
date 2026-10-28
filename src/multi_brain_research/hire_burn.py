"""Burn receipt for a posted hire reserve.

Marks the reserve. Does not send.
"""
from __future__ import annotations

import json

from .burn_receipt import receipt
from .inventory_gate import TOKEN


def mark(reserve: int) -> dict:
    return receipt({
        "request_id": "req_receipt",
        "token": TOKEN,
        "buyback_reserve_lamports": reserve,
        "action": "NO_EXECUTION",
    }, reserve)


def self_check() -> dict:
    body = mark(500_000)
    if body["burn_executed"] or body["reason"] != "RESERVE_MARKED":
        raise RuntimeError("BURN_MISMATCH")
    return {"reason": body["reason"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
