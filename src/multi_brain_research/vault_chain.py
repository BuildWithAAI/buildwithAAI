"""Chain-read of the curve vault still unpaid.
"""
from __future__ import annotations

import json

from .chain_atoms import atoms
from .inventory_gate import CURVE


def self_check() -> dict:
    body = atoms(CURVE, 10**12)
    if body["reason"] != "CURVE_VAULT":
        raise RuntimeError("VAULT_CHAIN_PAID")
    return body


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
