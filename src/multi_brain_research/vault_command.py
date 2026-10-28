"""Curve vault in the one command.

The vault stays unpaid even if the council agrees.
"""
from __future__ import annotations

import json

from .inventory_gate import CURVE, gate
from .live_pass import run_live


def run_vault(endpoint: str) -> dict:
    hold = gate(CURVE, 90, 10**12)
    if hold["fee_allowed"]:
        raise RuntimeError("VAULT_ALLOWED")
    passed = run_live(endpoint, CURVE, 90, 10**12)
    if passed.get("fee_status") == "PAID" or passed.get("reserve"):
        raise RuntimeError("VAULT_PAID")
    return {"wallet": "CURVE", "fee_status": "UNPAID", "reason": hold["reason"], "action": "NO_EXECUTION"}


def self_check() -> dict:
    return run_vault("https://api.mainnet-beta.solana.com")


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
