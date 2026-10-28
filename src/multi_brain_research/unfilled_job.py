"""Unfilled job.

If no specialist is admitted, the fee stays unpaid and no burn receipt
is written. The other AAI mint is not involved.
"""
from __future__ import annotations

import json

from .burn_receipt import receipt
from .fee_router import route


class UnfilledError(ValueError):
    pass


def close_unfilled(admission: dict, fee_lamports: int) -> dict:
    if admission.get("status") != "UNFILLED" or admission.get("action") != "NO_EXECUTION":
        raise UnfilledError("NOT_UNFILLED")
    if type(fee_lamports) is not int or fee_lamports < 0:
        raise UnfilledError("BAD_FEE")
    return {
        "request_id": admission["request_id"],
        "status": "UNFILLED",
        "admitted": None,
        "fee_lamports": fee_lamports,
        "fee_status": "UNPAID",
        "reserve_lamports": 0,
        "burn_receipt": None,
        "settlement": "none",
        "action": "NO_EXECUTION",
    }


def self_check() -> dict:
    closed = close_unfilled(
        {"request_id": "req_empty", "status": "UNFILLED", "admitted": None, "action": "NO_EXECUTION"},
        1_000_000,
    )
    if closed["fee_status"] != "UNPAID" or closed["burn_receipt"] is not None:
        raise UnfilledError("UNFILLED_MISMATCH")
    try:
        route({"request_id": "req_empty", "status": "UNFILLED", "action": "NO_EXECUTION"}, 1)
    except ValueError:
        refused = True
    else:
        refused = False
    if not refused:
        raise UnfilledError("ROUTER_ACCEPTED_UNFILLED")
    return {"fee_status": closed["fee_status"], "router_refused": refused, "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
