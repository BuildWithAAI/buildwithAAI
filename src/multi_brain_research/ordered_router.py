"""Router order.

Veto, then cap, then inventory. The first failure stops the fee.
"""
from __future__ import annotations

import json

from .fee_cap import cap
from .inventory_gate import gate


def route(fate: str, reserve: int, wallet: str, held_days: int, atoms: int) -> dict:
    if fate == "dead":
        return {"fee_status": "UNPAID", "stopped_at": "VETO", "action": "NO_EXECUTION"}
    capped = cap(reserve)
    if capped["reason"] == "OVER_CAP":
        return {"fee_status": "UNPAID", "stopped_at": "CAP", "action": "NO_EXECUTION"}
    hold = gate(wallet, held_days, atoms)
    if not hold["fee_allowed"]:
        return {"fee_status": "UNPAID", "stopped_at": "INVENTORY", "action": "NO_EXECUTION"}
    return {"fee_status": "PAID", "reserve": capped["reserve"], "action": "NO_EXECUTION"}


def self_check() -> dict:
    body = route("dead", 2_000_000, "holder_b", 30, 50_000_000)
    if body["stopped_at"] != "VETO":
        raise RuntimeError("ORDER_MISMATCH")
    return body


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
