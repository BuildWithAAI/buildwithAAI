"""Correct mint plus a short hold is still unpaid.
"""
from __future__ import annotations

import json

from .inventory_gate import TOKEN
from .mint_inventory import check


def self_check() -> dict:
    body = check(TOKEN, "holder_b", 1, 50_000_000)
    if body["fee_allowed"]:
        raise RuntimeError("SHORT_HOLD_PAID")
    return {"reason": body["reason"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
