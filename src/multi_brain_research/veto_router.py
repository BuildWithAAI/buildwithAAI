"""Fee router refuses a dead-veto hire before it splits.
"""
from __future__ import annotations

import json

from .fee_router import route


def route_live(fate: str, admission: dict, fee: int) -> dict:
    if fate == "dead":
        return {"fee_status": "UNPAID", "reason": "DEAD_VETO", "action": "NO_EXECUTION"}
    return route(admission, fee)


def self_check() -> dict:
    admission = {"request_id": "req", "status": "ADMITTED", "admitted": "fly_hemibrain_adverse_v1", "action": "NO_EXECUTION"}
    refused = route_live("dead", admission, 1_000_000)
    if refused["fee_status"] != "UNPAID":
        raise RuntimeError("DEAD_PAID")
    return {"dead": refused["reason"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
