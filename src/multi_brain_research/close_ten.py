"""One command for these ten steps.
"""
from __future__ import annotations

import json

from .clean_file import self_check as clean
from .match_dispute import self_check as dispute
from .match_pack import self_check as pack
from .pass_report import self_check as report
from .pay_not_skill import self_check as skill
from .short_account import self_check as short
from .snapshot_pay import self_check as pay
from .tape_hire import self_check as tape
from .zero_wallet import self_check as zero


def run() -> dict:
    return {
        "bps": pay()["bps"],
        "pack": pack()["complete"],
        "zero": zero()["reason"],
        "tape": tape()["missing"],
        "dispute": dispute()["score"],
        "clean": clean()["voted"],
        "short": short()["reason"],
        "skill": skill()["skill"],
        "first_fail": report()["first_fail"],
        "action": "NO_EXECUTION",
    }


if __name__ == "__main__":
    print(json.dumps(run(), sort_keys=True))
