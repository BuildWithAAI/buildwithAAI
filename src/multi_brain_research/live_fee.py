"""Live pass with the new-wallet schedule.

A 30-day hold pays 100 bps. A 1-day hold stays unpaid.
"""
from __future__ import annotations

import json

from .live_pass import run_live
from .new_wallet_fee import schedule


def run(endpoint: str, wallet: str, held_days: int, atoms: int) -> dict:
    fee = schedule(wallet, held_days, atoms, 1_000_000)
    if fee["fee_status"] != "PAID":
        return fee
    passed = run_live(endpoint, wallet, held_days, atoms)
    if passed.get("fee_status") == "UNPAID":
        return passed
    return {
        "fee_status": "PAID",
        "bps": fee["bps"],
        "reserve": fee["buyback_reserve_lamports"],
        "slot": passed.get("slot"),
        "action": "NO_EXECUTION",
    }


def self_check() -> dict:
    held = run("https://api.mainnet-beta.solana.com", "holder_b", 30, 50_000_000)
    new = run("https://api.mainnet-beta.solana.com", "holder_a", 1, 50_000_000)
    if held["bps"] != 100 or new["fee_status"] != "UNPAID":
        raise RuntimeError("BOUND_FEE_MISMATCH")
    return {"held_bps": held["bps"], "new": new["reason"], "reserve": held["reserve"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
