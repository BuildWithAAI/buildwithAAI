"""Refuse a hire when the two brains disagree.
"""
from __future__ import annotations

import json

from .two_receipt_consensus import consensus


def refuse(first: dict, second: dict) -> dict:
    agreed = consensus(first, second)
    if not agreed["hire_allowed"]:
        return {"status": "REFUSED", "reason": agreed["reason"], "action": "NO_EXECUTION"}
    return {"status": "ALLOWED", "reason": agreed["reason"], "action": "NO_EXECUTION"}


def self_check() -> dict:
    body = refuse({"prediction_ppm": 800_000}, {"prediction_ppm": 200_000})
    if body["status"] != "REFUSED":
        raise RuntimeError("DISAGREE_ALLOWED")
    return body


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
