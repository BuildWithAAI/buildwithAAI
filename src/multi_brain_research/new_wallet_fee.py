"""New-wallet surcharge.

Under 7 days the post fee is higher. After 7 days it is the normal split.
The curve vault still cannot pay. Nothing is sent.
"""
from __future__ import annotations

import json

from .inventory_gate import CURVE, MIN_DAYS, gate

NORMAL_BPS = 100
NEW_BPS = 250


class FeeScheduleError(ValueError):
    pass


def schedule(wallet: str, held_days: int, atoms: int, fee_lamports: int) -> dict:
    if wallet == CURVE:
        return {"fee_status": "UNPAID", "reason": "CURVE_VAULT", "bps": 0, "action": "NO_EXECUTION"}
    hold = gate(wallet, held_days, atoms)
    if not hold["fee_allowed"]:
        return {"fee_status": "UNPAID", "reason": hold["reason"], "bps": NEW_BPS, "action": "NO_EXECUTION"}
    bps = NORMAL_BPS if held_days >= MIN_DAYS else NEW_BPS
    charged = fee_lamports * bps // 10_000
    return {
        "fee_status": "PAID",
        "reason": "NORMAL" if bps == NORMAL_BPS else "NEW_WALLET",
        "bps": bps,
        "charged_lamports": charged,
        "operating_lamports": charged // 2,
        "buyback_reserve_lamports": charged - charged // 2,
        "action": "NO_EXECUTION",
    }


def self_check() -> dict:
    new = schedule("holder_a", 1, 50_000_000, 1_000_000)
    held = schedule("holder_b", 30, 50_000_000, 1_000_000)
    vault = schedule(CURVE, 90, 10**12, 1_000_000)
    if new["fee_status"] != "UNPAID" or held["bps"] != NORMAL_BPS or vault["fee_status"] != "UNPAID":
        raise FeeScheduleError("SCHEDULE_MISMATCH")
    if held["operating_lamports"] + held["buyback_reserve_lamports"] != held["charged_lamports"]:
        raise FeeScheduleError("SPLIT_MISMATCH")
    return {"new": new["reason"], "held_bps": held["bps"], "reserve": held["buyback_reserve_lamports"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
