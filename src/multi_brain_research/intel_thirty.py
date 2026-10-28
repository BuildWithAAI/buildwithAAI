"""One command for these ten intelligence steps.
"""
from __future__ import annotations

import json

from .abstain_board import show
from .adverse_label import label
from .cooldown_cap import check
from .dead_quorum_stress import run as dead_run
from .dispute_decay import regate
from .feature_memory import remember
from .quorum_pack import replay
from .specialist_quorum import quorum
from .veto_router import route_live
from pathlib import Path


def run() -> dict:
    memory = remember(None, {"signed_return": -0.2, "time": "now"})
    labeled = label("FIXTURE_TWO_ROW", 0.000030, 0.000024)
    votes = [
        {"prediction_ppm": 700_000, "verification": 60},
        {"prediction_ppm": 650_000, "verification": 55},
        {"prediction_ppm": None, "verification": 90},
    ]
    hired = quorum(votes, "live")
    decayed = regate(50, True)
    board = show([{"specialist_id": "no_trade_control_v1", "prediction_ppm": None}])
    routed = route_live("dead", {"request_id": "r", "status": "ADMITTED", "admitted": "fly", "action": "NO_EXECUTION"}, 1)
    path = Path("/tmp/aai-qpack.json")
    path.write_text(json.dumps({"quorum": [
        {"module_id": "fly_hemibrain_adverse_v1"},
        {"module_id": "frozen_prior_control_v1"},
        {"module_id": "no_trade_control_v1"},
    ]}))
    packed = replay(path)
    combo = check("agent_a", "agent_a", 500_000)
    dead = dead_run()
    return {
        "memory": memory["last"]["signed_return"],
        "label": labeled["label"],
        "quorum": hired["hire_allowed"],
        "decayed": decayed["reason"],
        "board": board["board"][0]["state"],
        "dead_fee": routed["reason"],
        "pack": packed["complete"],
        "repeat": combo["reason"],
        "dead_refused": dead["refused"],
        "market_skill": "NOT_ESTABLISHED",
        "action": "NO_EXECUTION",
    }


if __name__ == "__main__":
    print(json.dumps(run(), sort_keys=True))
