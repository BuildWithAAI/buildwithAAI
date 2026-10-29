"""One fee.

The pack reserve and the router reserve must match.
"""
from __future__ import annotations

import json

from .fee_router import route


def match(pack_reserve: int, fee_lamports: int) -> dict:
    routed = route({
        "request_id": "req",
        "status": "ADMITTED",
        "admitted": "fly_hemibrain_adverse_v1",
        "action": "NO_EXECUTION",
    }, fee_lamports)
    if pack_reserve != routed["buyback_reserve_lamports"]:
        return {"fee_status": "UNPAID", "reason": "RESERVE_MISMATCH", "action": "NO_EXECUTION"}
    return {"fee_status": "PAID", "reserve": pack_reserve, "action": "NO_EXECUTION"}


def self_check() -> dict:
    bad = match(5_000, 1_000_000)
    good = match(500_000, 1_000_000)
    if bad["fee_status"] != "UNPAID" or good["fee_status"] != "PAID":
        raise RuntimeError("ONE_FEE_MISMATCH")
    return {"bad": bad["reason"], "good": good["reserve"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
