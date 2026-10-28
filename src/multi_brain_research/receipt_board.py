"""Board from the last ten receipts.

Score and state only.
"""
from __future__ import annotations

import json


def board(receipts: list[dict]) -> dict:
    public = [{"specialist_id": row["specialist_id"], "verification": row["verification"], "state": row["state"]} for row in receipts[-10:]]
    return {"board": public, "count": len(public), "action": "NO_EXECUTION"}


def self_check() -> dict:
    rows = [{"specialist_id": f"s{i}", "verification": i, "state": "ANSWERED", "secret": "no"} for i in range(12)]
    body = board(rows)
    if body["count"] != 10 or "secret" in body["board"][-1]:
        raise RuntimeError("BOARD_MISMATCH")
    return {"count": body["count"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
