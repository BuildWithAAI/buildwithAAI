"""Inventory gate for the Anything AI mint.

A hire fee posts only if the wallet has a time-weighted hold.
The bonding-curve vault and a dust balance fail. No order is sent.
"""
from __future__ import annotations

import json
import math

TOKEN = "27RP3fkHt6T2QpCzsrJjk9oMZXAP5cya77VaR3UMpump"
CURVE = "Eq93BkkDVBLkjgHxZU6qVk7hrnzTnAyVfCNrXCVix1PL"
MIN_ATOMS = 1_000_000  # 1 token at 6 decimals
MIN_DAYS = 7


class InventoryError(ValueError):
    pass


def score(held_days: int, atoms: int) -> int:
    if type(held_days) is not int or held_days < 0 or type(atoms) is not int or atoms < 0:
        raise InventoryError("BAD_HOLD")
    if atoms < MIN_ATOMS or held_days < MIN_DAYS:
        return 0
    time_weight = min(held_days, 90) / 90
    size = math.sqrt(min(atoms, 100_000_000) / 100_000_000)
    return int(100 * time_weight * size)


def gate(wallet: str, held_days: int, atoms: int) -> dict:
    if wallet == CURVE:
        return {
            "wallet": wallet,
            "token": TOKEN,
            "score": 0,
            "fee_allowed": False,
            "reason": "CURVE_VAULT",
            "action": "NO_EXECUTION",
        }
    value = score(held_days, atoms)
    allowed = value >= 10
    return {
        "wallet": wallet,
        "token": TOKEN,
        "score": value,
        "held_days": held_days,
        "atoms": atoms,
        "fee_allowed": allowed,
        "reason": "INVENTORY_OK" if allowed else "DUST_OR_NEW",
        "action": "NO_EXECUTION",
    }


def self_check() -> dict:
    vault = gate(CURVE, 90, 1_000_000_000_000)
    dust = gate("holder_a", 30, 100)
    holder = gate("holder_b", 30, 50_000_000)
    if vault["fee_allowed"] or dust["fee_allowed"] or not holder["fee_allowed"]:
        raise InventoryError("GATE_MISMATCH")
    return {"vault": vault["reason"], "dust": dust["reason"], "holder": holder["score"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
