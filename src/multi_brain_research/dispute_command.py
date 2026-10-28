"""Dispute in the command.

An upheld dispute cuts the score. The next hire is unpaid.
"""
from __future__ import annotations

import json

from .dispute_decay import regate


def next_after_dispute(score: int) -> dict:
    gated = regate(score, True)
    return {"score": gated["score"], "fee_status": "UNPAID" if not gated["hire_allowed"] else "PAID", "reason": gated["reason"], "action": "NO_EXECUTION"}


def self_check() -> dict:
    body = next_after_dispute(50)
    if body["fee_status"] != "UNPAID":
        raise RuntimeError("DISPUTE_STILL_PAID")
    return body


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
