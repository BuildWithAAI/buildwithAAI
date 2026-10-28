"""Bind the inventory gate to the fee router.

A failed hold writes no reserve and no burn receipt. Same outcome as an
unfilled job. No order is sent.
"""
from __future__ import annotations

import json

from .fee_router import route
from .inventory_gate import gate
from .unfilled_job import close_unfilled


class BindError(ValueError):
    pass


def route_if_held(admission: dict, fee_lamports: int, wallet: str, held_days: int, atoms: int) -> dict:
    if admission.get("status") != "ADMITTED":
        return close_unfilled(admission, fee_lamports)
    hold = gate(wallet, held_days, atoms)
    if not hold["fee_allowed"]:
        return {
            "request_id": admission["request_id"],
            "status": "HELD_REFUSED",
            "admitted": admission.get("admitted"),
            "fee_status": "UNPAID",
            "reserve_lamports": 0,
            "burn_receipt": None,
            "hold": hold,
            "action": "NO_EXECUTION",
        }
    routed = route(admission, fee_lamports)
    routed["hold"] = hold
    return routed


def self_check() -> dict:
    admission = {
        "request_id": "req_hold",
        "status": "ADMITTED",
        "admitted": "fly_hemibrain_adverse_v1",
        "action": "NO_EXECUTION",
    }
    refused = route_if_held(admission, 1_000_000, "Eq93BkkDVBLkjgHxZU6qVk7hrnzTnAyVfCNrXCVix1PL", 90, 10**12)
    paid = route_if_held(admission, 1_000_000, "holder_b", 30, 50_000_000)
    if refused["fee_status"] != "UNPAID" or paid["buyback_reserve_lamports"] != 500_000:
        raise BindError("BIND_MISMATCH")
    return {"refused": refused["status"], "paid_reserve": paid["buyback_reserve_lamports"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
