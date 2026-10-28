"""A stale curve slot cannot hire.

The live slot must be at least the pack slot.
"""
from __future__ import annotations

import json

from .live_curve import read_curve


def fresh(endpoint: str, pack_slot: int) -> dict:
    curve = read_curve(endpoint)
    if curve["slot"] < pack_slot:
        return {"fee_status": "UNPAID", "reason": "STALE_SLOT", "action": "NO_EXECUTION"}
    return {"fee_status": "PAID", "slot": curve["slot"], "action": "NO_EXECUTION"}


def self_check() -> dict:
    body = fresh("https://api.mainnet-beta.solana.com", 10**12)
    if body["fee_status"] != "UNPAID":
        raise RuntimeError("STALE_PAID")
    return body


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
