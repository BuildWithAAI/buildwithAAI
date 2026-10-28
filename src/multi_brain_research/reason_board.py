"""Board keeps the abstain reason, not the receipt body.
"""
from __future__ import annotations

import json


def show(row: dict) -> dict:
    if row.get("prediction_ppm") is None:
        return {"specialist_id": row["specialist_id"], "state": "ABSTAINED", "reason": row.get("abstain_reason"), "action": "NO_EXECUTION"}
    return {"specialist_id": row["specialist_id"], "state": "ANSWERED", "action": "NO_EXECUTION"}


def self_check() -> dict:
    body = show({"specialist_id": "no_trade_control_v1", "prediction_ppm": None, "abstain_reason": "UNCALIBRATED", "receipt_body": "secret"})
    if "receipt_body" in body or body["reason"] != "UNCALIBRATED":
        raise RuntimeError("BOARD_LEAK")
    return body


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
