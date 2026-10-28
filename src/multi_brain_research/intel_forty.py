"""One command for these ten steps.
"""
from __future__ import annotations

import json

from .agent_rotation import rotate
from .answer_quorum import need_two
from .causal_check import causal
from .decay_stack import stack
from .label_pack import replay
from .mixed_coins import run as mixed
from .ordered_router import route
from .reason_board import show
from .three_way_score import score
from pathlib import Path


def run() -> dict:
    checked = causal([{"price": 1}, {"price": 2}], 0)
    three = score()
    thin = need_two([{"prediction_ppm": 1}, {"prediction_ppm": None}, {"prediction_ppm": None}])
    floored = stack(10)
    board = show({"specialist_id": "no_trade_control_v1", "prediction_ppm": None, "abstain_reason": "UNCALIBRATED"})
    stopped = route("dead", 500_000, "holder_b", 30, 50_000_000)
    path = Path("/tmp/aai-label-pack.json")
    path.write_text(json.dumps({"label": 1, "label_source": "later_observed"}))
    packed = replay(path)
    turned = rotate()
    coins = mixed()
    return {
        "causal": checked["read_future"],
        "no_trade": three["no_trade"],
        "thin": thin["reason"],
        "stack": floored["score"],
        "board": board["state"],
        "stopped": stopped["stopped_at"],
        "pack": packed["complete"],
        "rotation": turned["allowed"],
        "hired": coins["hired"],
        "market_skill": "NOT_ESTABLISHED",
        "action": "NO_EXECUTION",
    }


if __name__ == "__main__":
    print(json.dumps(run(), sort_keys=True))
