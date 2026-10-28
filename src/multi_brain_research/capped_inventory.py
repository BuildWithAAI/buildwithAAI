"""Fee cap plus inventory.

Over cap or the curve vault both pay nothing.
"""
from __future__ import annotations

import json

from .fee_cap import cap
from .inventory_gate import CURVE, gate


def pay(wallet: str, held_days: int, atoms: int, reserve: int) -> dict:
    capped = cap(reserve)
    hold = gate(wallet, held_days, atoms)
    if capped["reason"] == "OVER_CAP" or not hold["fee_allowed"] or wallet == CURVE:
        return {"reserve": 0, "reason": "UNPAID", "action": "NO_EXECUTION"}
    return {"reserve": capped["reserve"], "reason": "PAID", "action": "NO_EXECUTION"}


def self_check() -> dict:
    vault = pay(CURVE, 90, 10**12, 500_000)
    over = pay("holder_b", 30, 50_000_000, 2_000_000)
    if vault["reserve"] or over["reserve"]:
        raise RuntimeError("PAY_MISMATCH")
    return {"vault": vault["reason"], "over": over["reason"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
