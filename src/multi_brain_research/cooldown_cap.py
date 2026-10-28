"""Cooldown plus cap.

A repeat agent and an over-cap fee both stay unpaid.
"""
from __future__ import annotations

import json

from .cooldown_window import allow
from .fee_cap import cap


def check(agent_id: str, last: str | None, reserve: int) -> dict:
    window = allow(agent_id, last)
    capped = cap(reserve)
    if not window["allowed"] or capped["reason"] == "OVER_CAP":
        return {"fee_status": "UNPAID", "reason": window["reason"] if not window["allowed"] else capped["reason"], "action": "NO_EXECUTION"}
    return {"fee_status": "PAID", "reserve": capped["reserve"], "action": "NO_EXECUTION"}


def self_check() -> dict:
    repeat = check("agent_a", "agent_a", 500_000)
    over = check("agent_b", "agent_a", 2_000_000)
    if repeat["fee_status"] != "UNPAID" or over["fee_status"] != "UNPAID":
        raise RuntimeError("COMBO_MISMATCH")
    return {"repeat": repeat["reason"], "over": over["reason"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
