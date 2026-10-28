"""Curve vault cannot get a claim credit.
"""
from __future__ import annotations

import json

from .inventory_gate import CURVE


def credit(wallet: str) -> dict:
    if wallet == CURVE:
        return {"credited": False, "reason": "CURVE_VAULT", "action": "NO_EXECUTION"}
    return {"credited": True, "action": "NO_EXECUTION"}


def self_check() -> dict:
    body = credit(CURVE)
    if body["credited"]:
        raise RuntimeError("VAULT_CREDITED")
    return body


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
