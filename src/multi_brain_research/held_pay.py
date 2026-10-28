"""A 30-day hold of the correct mint pays.
"""
from __future__ import annotations

import json

from .inventory_gate import TOKEN
from .mint_inventory import check


def self_check() -> dict:
    body = check(TOKEN, "holder_b", 30, 50_000_000)
    if not body["fee_allowed"]:
        raise RuntimeError("HOLD_REFUSED")
    return {"reason": body["reason"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
