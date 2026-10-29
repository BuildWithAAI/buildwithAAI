"""Live pass requires a hold receipt.

No receipt, no fee.
"""
from __future__ import annotations

import json

from .hold_receipt import accept
from .live_fee import run


def run_with_receipt(endpoint: str, wallet: str, receipt: dict | None) -> dict:
    if not receipt:
        return {"fee_status": "UNPAID", "reason": "NO_RECEIPT", "action": "NO_EXECUTION"}
    checked = accept(receipt)
    if not checked["fee_allowed"]:
        return {"fee_status": "UNPAID", "reason": checked["reason"], "action": "NO_EXECUTION"}
    return run(endpoint, wallet, receipt["held_days"], receipt["atoms"])


def self_check() -> dict:
    missing = run_with_receipt("https://api.mainnet-beta.solana.com", "holder_b", None)
    typed = run_with_receipt("https://api.mainnet-beta.solana.com", "holder_b", {"held_days": 30, "atoms": 50_000_000})
    if missing["reason"] != "NO_RECEIPT" or typed["reason"] != "TYPED_HOLD":
        raise RuntimeError("RECEIPT_PASS_MISMATCH")
    return {"missing": missing["reason"], "typed": typed["reason"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
