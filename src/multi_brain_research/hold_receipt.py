"""Hold receipt.

Days and atoms must come from a chain read or a signed snapshot.
A typed number is refused.
"""
from __future__ import annotations

import json

ALLOWED = {"CHAIN_READ", "SIGNED_SNAPSHOT"}


def accept(receipt: dict) -> dict:
    if receipt.get("source") not in ALLOWED:
        return {"fee_allowed": False, "reason": "TYPED_HOLD", "action": "NO_EXECUTION"}
    if type(receipt.get("held_days")) is not int or type(receipt.get("atoms")) is not int:
        return {"fee_allowed": False, "reason": "BAD_HOLD", "action": "NO_EXECUTION"}
    return {"fee_allowed": True, "source": receipt["source"], "action": "NO_EXECUTION"}


def self_check() -> dict:
    typed = accept({"held_days": 30, "atoms": 50_000_000})
    signed = accept({"source": "SIGNED_SNAPSHOT", "held_days": 30, "atoms": 50_000_000})
    if typed["fee_allowed"] or not signed["fee_allowed"]:
        raise RuntimeError("HOLD_RECEIPT_MISMATCH")
    return {"typed": typed["reason"], "signed": signed["source"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
