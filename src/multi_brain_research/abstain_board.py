"""Public board.

An abstention is shown as abstained, never as zero.
"""
from __future__ import annotations

import json


def show(rows: list[dict]) -> dict:
    public = []
    for row in rows:
        if row.get("prediction_ppm") is None:
            public.append({"specialist_id": row["specialist_id"], "state": "ABSTAINED"})
        else:
            public.append({"specialist_id": row["specialist_id"], "state": "ANSWERED", "verification": row["verification"]})
    if any(item.get("prediction_ppm") == 0 for item in public):
        raise RuntimeError("ZERO_LEAK")
    return {"board": public, "action": "NO_EXECUTION"}


def self_check() -> dict:
    body = show([{"specialist_id": "no_trade_control_v1", "prediction_ppm": None}])
    if body["board"][0]["state"] != "ABSTAINED":
        raise RuntimeError("ABSTAIN_SHOWN_WRONG")
    return {"state": body["board"][0]["state"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
