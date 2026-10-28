"""Fee cap inside the command.

Over 1,000,000 lamports pays nothing.
"""
from __future__ import annotations

import json

from .fee_cap import cap


def run(reserve: int) -> dict:
    body = cap(reserve)
    if body["reason"] == "OVER_CAP":
        return {"fee_status": "UNPAID", "reserve": 0, "action": "NO_EXECUTION"}
    return {"fee_status": "PAID", "reserve": body["reserve"], "action": "NO_EXECUTION"}


def self_check() -> dict:
    body = run(2_000_000)
    if body["fee_status"] != "UNPAID":
        raise RuntimeError("CAP_COMMAND_MISMATCH")
    return body


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
