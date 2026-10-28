"""One command for these ten steps.
"""
from __future__ import annotations

import json

from .cap_and_hold import self_check as both
from .clean_board import self_check as board
from .credit_window import self_check as window
from .fail_report import self_check as report
from .fresh_slot import self_check as fresh
from .incomplete_burn import self_check as burn
from .reserved_pack import self_check as reserved
from .score_floor import self_check as score
from .short_hold import self_check as hold


def run() -> dict:
    return {
        "fresh": fresh()["fresh"],
        "stale": fresh()["stale"],
        "board": board()["kept"],
        "reserved": reserved()["reason"],
        "window": window()["far"],
        "score": score()["score"],
        "hire": both()["reserve"],
        "first_fail": report()["first_fail"],
        "burn": burn()["reason"],
        "hold": hold()["reason"],
        "action": "NO_EXECUTION",
    }


if __name__ == "__main__":
    print(json.dumps(run(), sort_keys=True))
