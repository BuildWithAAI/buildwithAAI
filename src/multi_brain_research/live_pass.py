"""Functional pass bound to the live curve.

A missing account leaves the hire unpaid. No send.
"""
from __future__ import annotations

import json

from .functional_pass import run
from .live_curve import CurveReadError, read_curve


def run_live(endpoint: str, wallet: str, held_days: int, atoms: int) -> dict:
    try:
        curve = read_curve(endpoint)
    except CurveReadError:
        return {"fee_status": "UNPAID", "reason": "MISSING_CURVE", "action": "NO_EXECUTION"}
    if curve["complete"]:
        return {"fee_status": "UNPAID", "reason": "GRADUATED", "action": "NO_EXECUTION"}
    body = run(wallet, held_days, atoms, False, False)
    body["slot"] = curve["slot"]
    body["real_quote"] = curve["real_quote"]
    return body


def self_check() -> dict:
    body = run_live("https://api.mainnet-beta.solana.com", "holder_b", 30, 50_000_000)
    if body["fee_status"] == "UNPAID" or body["real_quote"] != 71:
        raise RuntimeError("LIVE_PASS_MISMATCH")
    return {"slot": body["slot"], "reserve": body["reserve"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
