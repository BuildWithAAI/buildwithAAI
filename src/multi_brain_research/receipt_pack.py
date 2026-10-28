"""Council receipts go in the pack.

A side flag is refused.
"""
from __future__ import annotations

import json


def pack(votes: list[dict]) -> dict:
    if any("side" in vote for vote in votes):
        raise ValueError("SIDE_FLAG")
    return {"receipts": [{"prediction_ppm": vote["prediction_ppm"]} for vote in votes], "action": "NO_EXECUTION"}


def self_check() -> dict:
    body = pack([{"prediction_ppm": 650_000}, {"prediction_ppm": 700_000}, {"prediction_ppm": None}])
    if len(body["receipts"]) != 3:
        raise RuntimeError("RECEIPT_PACK_MISMATCH")
    return {"receipts": len(body["receipts"]), "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
