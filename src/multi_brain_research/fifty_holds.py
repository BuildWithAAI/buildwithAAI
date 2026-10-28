"""Fifty clean holds. Count paid.
"""
from __future__ import annotations

import json

from .inventory_gate import TOKEN, gate


def run() -> dict:
    paid = sum(1 for _ in range(50) if gate("holder_b", 30, 50_000_000)["fee_allowed"])
    if paid != 50:
        raise RuntimeError("HOLD_COUNT")
    return {"holds": 50, "paid": paid, "mint": TOKEN, "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(run(), sort_keys=True))
