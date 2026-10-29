"""One command for these ten steps.
"""
from __future__ import annotations

import json

from .all_fails import self_check as fails
from .big_reserve import self_check as big
from .chain_pay import self_check as chain
from .marker_reject import self_check as markers
from .mixed_receipts import run as mixed
from .old_tape import self_check as tape
from .skill_file import self_check as skill
from .two_disputes import self_check as disputes
from .zero_credit import self_check as zero


def run() -> dict:
    return {
        "chain_bps": chain()["bps"],
        "big": big()["reason"],
        "zero": zero()["reason"],
        "tape": tape()["reason"],
        "disputes": disputes()["floor"],
        "markers": markers()["elf"],
        "skill": skill()["skill"],
        "fails": fails()["count"],
        "paid": mixed()["paid"],
        "action": "NO_EXECUTION",
    }


if __name__ == "__main__":
    print(json.dumps(run(), sort_keys=True))
