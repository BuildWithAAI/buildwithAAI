"""A zero balance cannot get a claim credit.
"""
from __future__ import annotations

import json

from .chain_atoms import atoms


def credit(wallet: str) -> dict:
    body = atoms(wallet, 1)
    if body["atoms"] <= 0:
        return {"credited": False, "reason": body["reason"], "action": "NO_EXECUTION"}
    return {"credited": True, "action": "NO_EXECUTION"}


def self_check() -> dict:
    body = credit("11111111111111111111111111111111")
    if body["credited"]:
        raise RuntimeError("ZERO_CREDITED")
    return body


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
