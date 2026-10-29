"""Paid only when receipt, tape, fee, and inspect all pass.
"""
from __future__ import annotations

import json


def paid(row: dict) -> bool:
    return row["receipt"] and row["tape"] and row["fee_match"] and row["inspect"] == "CLEAN"


def self_check() -> dict:
    rows = [
        {"receipt": True, "tape": True, "fee_match": True, "inspect": "CLEAN"},
        {"receipt": True, "tape": True, "fee_match": True, "inspect": "EXECUTABLE"},
    ]
    count = sum(1 for row in rows if paid(row))
    if count != 1:
        raise RuntimeError("INSPECT_COUNT")
    return {"paid": count, "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
