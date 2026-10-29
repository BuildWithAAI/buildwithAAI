"""A zero-balance wallet stays unpaid.
"""
from __future__ import annotations

import json

from .chain_atoms import atoms


def self_check() -> dict:
    body = atoms("11111111111111111111111111111111", 50_000_000)
    if body["atoms"] or body["used_typed"]:
        raise RuntimeError("ZERO_USED_TYPED")
    return {"reason": body["reason"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
