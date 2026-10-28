"""Twenty agents.

Paid only when every gate passes.
"""
from __future__ import annotations

import json


def passes(agent: dict) -> bool:
    return (
        agent["curve"]
        and not agent["sandbox"]
        and not agent["dead"]
        and not agent["vault"]
        and agent["answers"] >= 2
        and agent["agree"]
        and agent["reserve"] <= 1_000_000
        and not agent["complete"]
        and agent["mint_ok"]
    )


def run() -> dict:
    agents = []
    for index in range(20):
        agents.append({
            "curve": index != 0,
            "sandbox": index == 1,
            "dead": index == 2,
            "vault": index == 3,
            "answers": 1 if index == 4 else 2,
            "agree": index != 5,
            "reserve": 2_000_000 if index == 6 else 500_000,
            "complete": index == 7,
            "mint_ok": index != 8,
        })
    paid = sum(1 for agent in agents if passes(agent))
    if paid != 11:
        raise RuntimeError("GATE_COUNT_MISMATCH")
    return {"agents": 20, "paid": paid, "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(run(), sort_keys=True))
