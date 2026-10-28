"""Dead-coin veto.

A dead coin cannot be hired even if the brains agree.
"""
from __future__ import annotations

import json


def veto(fate: str, agreed: bool) -> dict:
    if fate == "dead":
        return {"hire_allowed": False, "reason": "DEAD_VETO", "action": "NO_EXECUTION"}
    return {"hire_allowed": agreed, "reason": "LIVE", "action": "NO_EXECUTION"}


def self_check() -> dict:
    dead = veto("dead", True)
    live = veto("live", True)
    if dead["hire_allowed"] or not live["hire_allowed"]:
        raise RuntimeError("VETO_MISMATCH")
    return {"dead": dead["reason"], "live": live["reason"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
