"""One hundred agents.

Report paid, unpaid, and the first failing gate.
"""
from __future__ import annotations

import json

GATES = ("curve", "sandbox", "dead", "vault", "answers", "agree", "reserve", "complete", "mint_ok")


def first_fail(agent: dict) -> str | None:
    if not agent["curve"]:
        return "curve"
    if agent["sandbox"]:
        return "sandbox"
    if agent["dead"]:
        return "dead"
    if agent["vault"]:
        return "vault"
    if agent["answers"] < 2:
        return "answers"
    if not agent["agree"]:
        return "agree"
    if agent["reserve"] > 1_000_000:
        return "reserve"
    if agent["complete"]:
        return "complete"
    if not agent["mint_ok"]:
        return "mint_ok"
    return None


def run() -> dict:
    paid = unpaid = 0
    first = None
    for index in range(100):
        agent = {
            "curve": index != 3,
            "sandbox": index % 9 == 0,
            "dead": index % 8 == 0,
            "vault": index % 10 == 0,
            "answers": 2,
            "agree": True,
            "reserve": 500_000,
            "complete": False,
            "mint_ok": True,
        }
        failed = first_fail(agent)
        if failed:
            unpaid += 1
            first = first or failed
        else:
            paid += 1
    return {"agents": 100, "paid": paid, "unpaid": unpaid, "first_fail": first, "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(run(), sort_keys=True))
