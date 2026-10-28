"""Fresh slot can hire. Stale cannot.
"""
from __future__ import annotations

import json

from .live_curve import read_curve


def hire(endpoint: str, pack_slot: int) -> dict:
    live = read_curve(endpoint)["slot"]
    if pack_slot > live:
        return {"fee_status": "UNPAID", "reason": "STALE_SLOT", "action": "NO_EXECUTION"}
    return {"fee_status": "PAID", "slot": live, "action": "NO_EXECUTION"}


def self_check() -> dict:
    fresh = hire("https://api.mainnet-beta.solana.com", 1)
    stale = hire("https://api.mainnet-beta.solana.com", 10**12)
    if fresh["fee_status"] != "PAID" or stale["fee_status"] != "UNPAID":
        raise RuntimeError("FRESH_MISMATCH")
    return {"fresh": fresh["fee_status"], "stale": stale["reason"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
