"""Skill remains closed even if this pass pays.
"""
from __future__ import annotations

import json

from .skill_closed import mark
from .snapshot_pay import self_check as paid


def self_check() -> dict:
    body = paid()
    skill = mark(0.2)
    if body.get("bps") != 100 or skill["skill"] != "NOT_ESTABLISHED":
        raise RuntimeError("SKILL_OPENED_ON_PAY")
    return {"bps": body["bps"], "skill": skill["skill"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
