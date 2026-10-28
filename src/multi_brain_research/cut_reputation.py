"""Next hire uses the cut verification.

A specialist that fell below the floor is not admitted again.
"""
from __future__ import annotations

import json

from .receipt_hire import hire


def next_hire(cut_verification: int) -> dict:
    return hire(100_000, cut_verification)


def self_check() -> dict:
    blocked = next_hire(15)
    allowed = next_hire(55)
    if blocked["status"] != "UNFILLED" or allowed["admitted"] != "fly_hemibrain_adverse_v1":
        raise RuntimeError("CUT_MISMATCH")
    return {"cut_15": blocked["status"], "cut_55": allowed["status"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
