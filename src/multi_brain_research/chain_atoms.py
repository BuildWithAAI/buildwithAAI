"""Chain atoms replace typed atoms.
"""
from __future__ import annotations

import json

from .chain_inventory import lookup
from .inventory_gate import CURVE


def atoms(wallet: str, typed: int) -> dict:
    if wallet == CURVE:
        return {"atoms": 0, "reason": "CURVE_VAULT", "used_typed": False, "action": "NO_EXECUTION"}
    body = lookup(wallet)
    return {"atoms": body.get("atoms", 0), "reason": body["reason"], "used_typed": False, "ignored": typed, "action": "NO_EXECUTION"}


def self_check() -> dict:
    body = atoms(CURVE, 50_000_000)
    if body["used_typed"] or body["atoms"]:
        raise RuntimeError("TYPED_USED")
    return body


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
