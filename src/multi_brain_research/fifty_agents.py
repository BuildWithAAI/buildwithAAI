"""Fifty agents through every gate.
"""
from __future__ import annotations

import json

from .gated_agents import passes


def run() -> dict:
    paid = unpaid = 0
    for index in range(50):
        agent = {
            "curve": True,
            "sandbox": index % 7 == 0,
            "dead": index % 11 == 0,
            "vault": index % 13 == 0,
            "answers": 2,
            "agree": index % 5 != 0,
            "reserve": 500_000,
            "complete": False,
            "mint_ok": True,
        }
        if passes(agent):
            paid += 1
        else:
            unpaid += 1
    if paid + unpaid != 50 or paid == 0:
        raise RuntimeError("FIFTY_MISMATCH")
    return {"agents": 50, "paid": paid, "unpaid": unpaid, "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(run(), sort_keys=True))
