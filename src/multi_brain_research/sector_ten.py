"""One command for these ten steps.
"""
from __future__ import annotations

import json
from pathlib import Path

from .capped_clean import self_check as capped
from .claim_in_pack import self_check as claim
from .gate_report import self_check as report
from .mint_inventory import self_check as mint
from .old_credit import self_check as old
from .pack_burn import self_check as burn
from .receipt_board import self_check as board
from .sandbox_board import self_check as sandbox
from .stale_slot import self_check as stale


def run() -> dict:
    return {
        "stale": stale()["reason"],
        "board": board()["count"],
        "claim": claim()["handle"],
        "old_credit": old()["reason"],
        "sandbox": sandbox()["state"],
        "reserve": capped()["reserve"],
        "report": report()["paid"],
        "burn": burn()["reason"],
        "mint": mint()["reason"],
        "action": "NO_EXECUTION",
    }


if __name__ == "__main__":
    print(json.dumps(run(), sort_keys=True))
