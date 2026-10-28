"""Curve vault fails the 30-day hold too.
"""
from __future__ import annotations

import json

from .inventory_gate import CURVE, TOKEN
from .mint_inventory import check


def self_check() -> dict:
    body = check(TOKEN, CURVE, 90, 10**12)
    if body["fee_allowed"]:
        raise RuntimeError("VAULT_HELD")
    return {"reason": body["reason"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
