"""One hundred mixed receipts.

Paid only with a receipt, a tape, and a matching fee.
"""
from __future__ import annotations

import json


def passes(row: dict) -> bool:
    return row["receipt"] and row["tape"] and row["fee_match"]


def run() -> dict:
    paid = unpaid = 0
    for index in range(100):
        row = {"receipt": index % 2 == 0, "tape": index % 3 != 0, "fee_match": index % 5 != 0}
        if passes(row):
            paid += 1
        else:
            unpaid += 1
    if paid + unpaid != 100 or paid == 0:
        raise RuntimeError("MIX_COUNT")
    return {"paid": paid, "unpaid": unpaid, "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(run(), sort_keys=True))
