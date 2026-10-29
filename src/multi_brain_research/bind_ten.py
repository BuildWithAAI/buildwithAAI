"""One command for these ten bindings. Skill stays closed.
"""
from __future__ import annotations

import json

from .allowed_curve import self_check as curve
from .chain_atoms import self_check as atoms
from .council_brains import self_check as council
from .dispute_hash import self_check as dispute
from .inspect_first import self_check as inspect
from .one_fee_pass import self_check as fee
from .pass_pack import self_check as pack
from .receipt_pass import self_check as receipt
from .skill_closed import self_check as skill
from .tape_brain import self_check as tape


def run() -> dict:
    return {
        "receipt": receipt()["missing"],
        "fee": fee()["reason"],
        "curve": curve()["reason"],
        "pack": pack()["complete"],
        "atoms": atoms()["reason"],
        "council": council()["caller"],
        "tape": tape()["reason"],
        "dispute": dispute()["reason"],
        "inspect": inspect()["reason"],
        "skill": skill()["skill"],
        "action": "NO_EXECUTION",
    }


if __name__ == "__main__":
    print(json.dumps(run(), sort_keys=True))
