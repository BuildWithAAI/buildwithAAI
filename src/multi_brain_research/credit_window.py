"""Credit only if the slot is within 10,000 of live.
"""
from __future__ import annotations

import json

from .live_curve import read_curve

WINDOW = 10_000


def allow(endpoint: str, pack_slot: int) -> dict:
    live = read_curve(endpoint)["slot"]
    if abs(live - pack_slot) > WINDOW:
        return {"credited": False, "reason": "OUT_OF_WINDOW", "action": "NO_EXECUTION"}
    return {"credited": True, "action": "NO_EXECUTION"}


def self_check() -> dict:
    live = read_curve("https://api.mainnet-beta.solana.com")["slot"]
    near = allow("https://api.mainnet-beta.solana.com", live)
    far = allow("https://api.mainnet-beta.solana.com", 1)
    if not near["credited"] or far["credited"]:
        raise RuntimeError("WINDOW_MISMATCH")
    return {"near": True, "far": far["reason"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
