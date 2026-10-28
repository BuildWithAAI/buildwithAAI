"""One fixture tape row from the decoded curve account.

It is an account snapshot, not a trade. Marked as such.
"""
from __future__ import annotations

import json

from .curve_account_decode import decode
from .inventory_gate import TOKEN

CURVE = "Eq93BkkDVBLkjgHxZU6qVk7hrnzTnAyVfCNrXCVix1PL"


def tape_from_account(raw_account: dict) -> dict:
    decoded = decode(raw_account)
    return {
        "mint": TOKEN,
        "curve": CURVE,
        "virtual_reserves": decoded["virtual_reserves"],
        "real_reserves": decoded["real_reserves"],
        "complete": decoded["complete"],
        "classification": "ACCOUNT_DECODE_NOT_A_TRADE",
        "missing": decoded["missing"],
        "action": "NO_EXECUTION",
    }


def self_check() -> dict:
    from pathlib import Path
    row = tape_from_account(json.loads(Path("/tmp/curve-account.json").read_text()))
    if row["classification"] != "ACCOUNT_DECODE_NOT_A_TRADE" or row["complete"]:
        raise RuntimeError("TAPE_MISMATCH")
    return {"classification": row["classification"], "complete": row["complete"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
