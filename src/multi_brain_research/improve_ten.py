"""One command for these ten improvements.
"""
from __future__ import annotations

import json

from .artifact_inspect import self_check as sandbox
from .brain_votes import self_check as votes
from .chain_inventory import self_check as inventory
from .curve_tape import self_check as tape
from .evidence_dispute import self_check as dispute
from .hold_receipt import self_check as hold
from .one_fee import self_check as fee
from .rpc_allow import self_check as rpc
from .signed_pack import self_check as pack
from .skill_closed import self_check as skill


def run() -> dict:
    return {
        "hold": hold()["typed"],
        "fee": fee()["bad"],
        "rpc": rpc()["rpc"],
        "pack": pack()["tamper_refused"],
        "inventory": inventory()["vault"],
        "votes": votes()["votes"],
        "tape": tape()["slot"],
        "dispute": dispute()["bare"],
        "sandbox": sandbox()["bad"],
        "skill": skill()["skill"],
        "action": "NO_EXECUTION",
    }


if __name__ == "__main__":
    print(json.dumps(run(), sort_keys=True))
