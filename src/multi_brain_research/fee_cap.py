"""Fee cap.

A hire cannot reserve more than 1,000,000 lamports.
"""
from __future__ import annotations

import json

CAP = 1_000_000


def cap(reserve: int) -> dict:
    if type(reserve) is not int or reserve < 0:
        raise ValueError("BAD_RESERVE")
    if reserve > CAP:
        return {"reserve": 0, "reason": "OVER_CAP", "action": "NO_EXECUTION"}
    return {"reserve": reserve, "reason": "WITHIN_CAP", "action": "NO_EXECUTION"}


def self_check() -> dict:
    over = cap(2_000_000)
    ok = cap(500_000)
    if over["reserve"] or ok["reserve"] != 500_000:
        raise RuntimeError("CAP_MISMATCH")
    return {"over": over["reason"], "ok": ok["reserve"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
