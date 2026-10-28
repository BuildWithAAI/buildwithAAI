"""Refuse a live-skill claim on an account decode.

An account snapshot is not a market result.
"""
from __future__ import annotations

import json


class ClaimError(ValueError):
    pass


def claim(row: dict) -> dict:
    if row.get("classification") == "ACCOUNT_DECODE_NOT_A_TRADE":
        return {
            "market_skill": "NOT_ESTABLISHED",
            "reason": "ACCOUNT_IS_NOT_A_TRADE",
            "accepted": False,
            "action": "NO_EXECUTION",
        }
    if row.get("classification") not in {"CURVE_FIXTURE_NOT_CHAIN_ATTESTED", "FIXTURE_TWO_ROW"}:
        raise ClaimError("UNKNOWN_CLASS")
    return {
        "market_skill": "NOT_ESTABLISHED",
        "reason": "FIXTURE_ONLY",
        "accepted": False,
        "action": "NO_EXECUTION",
    }


def self_check() -> dict:
    account = claim({"classification": "ACCOUNT_DECODE_NOT_A_TRADE"})
    if account["accepted"] or account["market_skill"] != "NOT_ESTABLISHED":
        raise ClaimError("CLAIM_ACCEPTED")
    return account


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
