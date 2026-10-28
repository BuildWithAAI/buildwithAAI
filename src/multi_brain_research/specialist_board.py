"""Public specialist board.

Score and admission only. No wallet, no receipt body.
"""
from __future__ import annotations

import json


def board(rows: list[dict]) -> dict:
    public = [{"specialist_id": row["specialist_id"], "verification": row["verification"], "admitted": row["admitted"]} for row in rows]
    return {"board": public, "count": len(public), "action": "NO_EXECUTION"}


def self_check() -> dict:
    body = board([{"specialist_id": "fly_hemibrain_adverse_v1", "verification": 55, "admitted": True, "secret": "no"}])
    if "secret" in body["board"][0]:
        raise RuntimeError("SECRET_LEAKED")
    return {"count": body["count"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
