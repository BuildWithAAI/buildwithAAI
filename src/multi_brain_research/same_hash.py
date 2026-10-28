"""Burn and credit both need the same pack hash.
"""
from __future__ import annotations

import json


def allow(burn_hash: str, credit_hash: str) -> dict:
    if burn_hash != credit_hash:
        return {"allowed": False, "reason": "HASH_MISMATCH", "action": "NO_EXECUTION"}
    return {"allowed": True, "action": "NO_EXECUTION"}


def self_check() -> dict:
    body = allow("a" * 64, "b" * 64)
    if body["allowed"]:
        raise RuntimeError("MISMATCH_ALLOWED")
    return body


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
