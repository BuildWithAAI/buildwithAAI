"""One fee inside the receipt pass.

Pack reserve must match the router reserve.
"""
from __future__ import annotations

import json

from .one_fee import match
from .receipt_pass import run_with_receipt


def run(endpoint: str, wallet: str, receipt: dict, pack_reserve: int, fee_lamports: int) -> dict:
    passed = run_with_receipt(endpoint, wallet, receipt)
    if passed.get("fee_status") == "UNPAID":
        return passed
    same = match(pack_reserve, fee_lamports)
    if same["fee_status"] != "PAID":
        return same
    passed["reserve"] = same["reserve"]
    return passed


def self_check() -> dict:
    receipt = {"source": "SIGNED_SNAPSHOT", "held_days": 30, "atoms": 50_000_000}
    bad = run("https://api.mainnet-beta.solana.com", "holder_b", receipt, 5_000, 1_000_000)
    if bad["reason"] != "RESERVE_MISMATCH":
        raise RuntimeError("ONE_FEE_PASS_MISMATCH")
    return {"reason": bad["reason"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
