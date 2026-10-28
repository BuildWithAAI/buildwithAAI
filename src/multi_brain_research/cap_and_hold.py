"""Cap and inventory both apply to the clean hire.
"""
from __future__ import annotations

import json

from .fee_cap import cap
from .inventory_gate import gate
from .live_pass import run_live


def run(endpoint: str, wallet: str, held_days: int, atoms: int) -> dict:
    hold = gate(wallet, held_days, atoms)
    if not hold["fee_allowed"]:
        return {"fee_status": "UNPAID", "reason": hold["reason"], "action": "NO_EXECUTION"}
    passed = run_live(endpoint, wallet, held_days, atoms)
    reserved = cap(passed.get("reserve", 0))
    if reserved["reason"] == "OVER_CAP":
        return {"fee_status": "UNPAID", "reason": "OVER_CAP", "action": "NO_EXECUTION"}
    return {"fee_status": "PAID", "reserve": reserved["reserve"], "action": "NO_EXECUTION"}


def self_check() -> dict:
    return run("https://api.mainnet-beta.solana.com", "holder_b", 30, 50_000_000)


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
