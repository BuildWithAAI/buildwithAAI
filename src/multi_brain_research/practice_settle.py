"""Settle a passed economy run into demo credits.

This is the practice market's unit, not a wallet. A paid chain adds credits.
An unpaid chain does not.
"""
from __future__ import annotations

import json

UNIT = 1_000_000


class SettleError(ValueError):
    pass


def settle(linked: dict, credits: int) -> dict:
    if linked.get("action") != "NO_EXECUTION" or type(credits) is not int or credits < 0:
        raise SettleError("BAD_SETTLEMENT")
    if linked.get("paid"):
        delta = 1 * UNIT
        reason = "PAID_CHAIN"
    else:
        delta = 0
        reason = "UNPAID_CHAIN"
    return {
        "request_id": linked["request_id"],
        "credits_before": credits,
        "credits_after": credits + delta,
        "delta_micro": delta,
        "reason": reason,
        "quote_unit": "MICRO_DEMO_USD",
        "wallet": "NONE",
        "action": "NO_EXECUTION",
    }


def self_check() -> dict:
    paid = settle({"request_id": "req_pass_1", "paid": True, "action": "NO_EXECUTION"}, 10 * UNIT)
    empty = settle({"request_id": "req_pass_1", "paid": False, "action": "NO_EXECUTION"}, 10 * UNIT)
    if paid["delta_micro"] != UNIT or empty["credits_after"] != 10 * UNIT:
        raise SettleError("SETTLE_MISMATCH")
    return {"paid_after": paid["credits_after"], "empty_after": empty["credits_after"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
