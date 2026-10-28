"""One command for the ten intelligence steps.

No order. No market skill.
"""
from __future__ import annotations

import json
from pathlib import Path

from .dead_hire import run_dead
from .disagree_refuse import refuse
from .evidence_pack import write_pack
from .fee_cap import cap
from .hire_cooldown import once
from .pack_replay import replay
from .second_brain import second
from .specialist_board import board
from .two_receipt_consensus import consensus


def run() -> dict:
    other = second()
    first = {"prediction_ppm": 598_687, "action": "NO_EXECUTION"}
    agreed = consensus(first, other)
    dead = run_dead()
    blocked = refuse({"prediction_ppm": 800_000}, {"prediction_ppm": 200_000})
    public = board([{"specialist_id": "fly_hemibrain_adverse_v1", "verification": 55, "admitted": agreed["hire_allowed"]}])
    capped = cap(500_000)
    seen: set[str] = set()
    cool = once("agent_a", seen)
    path = Path("/tmp/aai-intel-pack.json")
    write_pack(path, {"slot": 1}, other, {"status": "UPHELD"}, "f" * 64)
    packed = replay(path)
    return {
        "second_ppm": other["prediction_ppm"],
        "agreed": agreed["agreed"],
        "dead": dead["mint"],
        "disagree": blocked["status"],
        "board": public["count"],
        "reserve": capped["reserve"],
        "cooldown": cool["reason"],
        "pack": packed["complete"],
        "market_skill": "NOT_ESTABLISHED",
        "action": "NO_EXECUTION",
    }


if __name__ == "__main__":
    print(json.dumps(run(), sort_keys=True))
