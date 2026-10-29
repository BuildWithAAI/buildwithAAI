"""One command for these ten, plus the simulator.
"""
from __future__ import annotations

import json

from .five_pack import self_check as pack
from .four_gates import self_check as gates
from .missing_signed import self_check as missing
from .pdf_clean import self_check as pdf
from .skill_guard import self_check as skill
from .tape_age import self_check as tape
from .three_disputes import self_check as disputes
from .vault_chain import self_check as vault
from .volume_sim import self_check as sim
from .zero_both import self_check as zero


def run() -> dict:
    return {
        "tape": tape()["old"],
        "pack": pack()["complete"],
        "zero": zero()["reason"],
        "disputes": disputes()["score"],
        "pdf": pdf()["reason"],
        "skill": skill()["skill"],
        "gates": gates()["paid"],
        "vault": vault()["reason"],
        "missing": missing()["refused"],
        "sim": sim()["rug"],
        "action": "NO_EXECUTION",
    }


if __name__ == "__main__":
    print(json.dumps(run(), sort_keys=True))
