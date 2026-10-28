"""Inventory must see the correct mint in the same call.
"""
from __future__ import annotations

import json

from .inventory_gate import TOKEN, gate


def check(mint: str, wallet: str, held_days: int, atoms: int) -> dict:
    if mint != TOKEN:
        return {"fee_allowed": False, "reason": "WRONG_MINT", "action": "NO_EXECUTION"}
    body = gate(wallet, held_days, atoms)
    body["mint"] = mint
    return body


def self_check() -> dict:
    bad = check("other", "holder_b", 30, 50_000_000)
    if bad["fee_allowed"]:
        raise RuntimeError("WRONG_MINT_ALLOWED")
    return {"reason": bad["reason"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
