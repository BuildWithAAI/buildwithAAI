"""One command for these ten steps.
"""
from __future__ import annotations

import json

from .abstain_not_zero import self_check as abstain
from .fifty_holds import run as holds
from .held_pay import self_check as held
from .live_window import self_check as window
from .reserved_replay import self_check as reserved
from .same_hash import self_check as same
from .score_lift import self_check as lift
from .vault_hold import self_check as vault
from .zero_floor import self_check as floor


def run() -> dict:
    return {
        "held": held()["reason"],
        "lift": lift()["score"],
        "abstain": abstain()["state"],
        "reserved": reserved()["refused"],
        "window": window()["credited"],
        "hash": same()["reason"],
        "floor": floor()["score"],
        "vault": vault()["reason"],
        "holds": holds()["paid"],
        "action": "NO_EXECUTION",
    }


if __name__ == "__main__":
    print(json.dumps(run(), sort_keys=True))
