"""Handle claim.

Reserved names are refused. A free handle gets a device receipt.
This is not on chain.
"""
from __future__ import annotations

import hashlib
import json
import re

RESERVED = {
    "zoora", "aai", "solana", "bitcoin", "ethereum", "pump",
    "binance", "coinbase", "blackrock", "sequoia", "a16z",
}


class HandleError(ValueError):
    pass


def claim(name: str) -> dict:
    handle = name.removeprefix("@").strip().lower()
    if not re.fullmatch(r"[a-z0-9_]{1,16}", handle):
        raise HandleError("BAD_HANDLE")
    if handle in RESERVED:
        return {"handle": handle, "claimed": False, "reason": "RESERVED", "chain": False}
    digest = hashlib.sha256(f"zoora-handle:{handle}".encode()).hexdigest()
    return {"handle": handle, "claimed": True, "receipt_sha256": digest, "chain": False, "action": "NO_EXECUTION"}


def self_check() -> dict:
    free = claim("@john")
    locked = claim("solana")
    if not free["claimed"] or locked["claimed"] or free["chain"]:
        raise HandleError("CLAIM_MISMATCH")
    return {"free": free["handle"], "locked": locked["reason"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
