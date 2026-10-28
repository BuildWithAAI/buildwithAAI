"""Refuse credit if the pack slot is older than the live slot by too much.

A slot behind the live read by more than 10,000 is stale.
"""
from __future__ import annotations

import json

from .live_curve import read_curve


def credit(endpoint: str, pack_slot: int) -> dict:
    live = read_curve(endpoint)["slot"]
    if live - pack_slot > 10_000:
        return {"credited": False, "reason": "OLD_SLOT", "action": "NO_EXECUTION"}
    return {"credited": True, "action": "NO_EXECUTION"}


def self_check() -> dict:
    body = credit("https://api.mainnet-beta.solana.com", 1)
    if body["credited"]:
        raise RuntimeError("OLD_CREDITED")
    return body


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
