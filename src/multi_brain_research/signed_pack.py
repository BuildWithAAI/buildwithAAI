"""Signed pack.

Slot, council, bps, reserve, and claim hash are one hash.
A changed byte fails replay.
"""
from __future__ import annotations

import hashlib
import json


def sign(pack: dict) -> str:
    body = {key: pack[key] for key in ("slot", "council", "bps", "reserve", "claim_sha256")}
    return hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()


def replay(pack: dict) -> dict:
    if sign(pack) != pack.get("pack_sha256"):
        raise ValueError("PACK_TAMPERED")
    return {"complete": True, "action": "NO_EXECUTION"}


def self_check() -> dict:
    pack = {"slot": 1, "council": "WEIGHTED", "bps": 100, "reserve": 500_000, "claim_sha256": "a" * 64}
    pack["pack_sha256"] = sign(pack)
    good = replay(pack)
    pack["bps"] = 250
    try:
        replay(pack)
    except ValueError:
        refused = True
    else:
        refused = False
    if not good["complete"] or not refused:
        raise RuntimeError("SIGN_MISMATCH")
    return {"complete": True, "tamper_refused": refused, "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
