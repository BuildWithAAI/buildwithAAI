"""Public burn receipt for a reserved hire fee.

Records that a reserve was marked for buyback-burn of Anything AI.
It does not send a transaction and does not touch the other AAI mint.
"""
from __future__ import annotations

import hashlib
import json

from .fee_router import CURVE, OTHER_AAI, TOKEN


class BurnError(ValueError):
    pass


def receipt(routed: dict, spent_lamports: int) -> dict:
    if routed.get("action") != "NO_EXECUTION" or routed.get("token") != TOKEN:
        raise BurnError("WRONG_TOKEN")
    if routed.get("token") == OTHER_AAI:
        raise BurnError("OTHER_POOL")
    reserve = routed.get("buyback_reserve_lamports")
    if type(spent_lamports) is not int or spent_lamports < 0 or spent_lamports > reserve:
        raise BurnError("OVER_RESERVE")
    body = {
        "request_id": routed["request_id"],
        "token": TOKEN,
        "curve": CURVE,
        "not_this_token": OTHER_AAI,
        "reserved_lamports": reserve,
        "spent_lamports": spent_lamports,
        "burn_executed": False,
        "reason": "RESERVE_MARKED" if spent_lamports else "NOTHING_TO_BURN",
        "settlement": "none",
        "action": "NO_EXECUTION",
    }
    body["receipt_sha256"] = hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()
    return body


def self_check() -> dict:
    routed = {
        "request_id": "req_market_1",
        "token": TOKEN,
        "buyback_reserve_lamports": 500_000,
        "action": "NO_EXECUTION",
    }
    marked = receipt(routed, 500_000)
    empty = receipt({**routed, "buyback_reserve_lamports": 0}, 0)
    if marked["burn_executed"] or empty["reason"] != "NOTHING_TO_BURN" or marked["token"] == OTHER_AAI:
        raise BurnError("RECEIPT_MISMATCH")
    return {"marked": marked["reason"], "empty": empty["reason"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
