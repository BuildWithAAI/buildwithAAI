"""One command for these ten steps.
"""
from __future__ import annotations

import json

from .abstain_credit import self_check as abstain
from .clean_hire import run as clean
from .hundred_agents import run as hundred
from .missing_field import self_check as missing
from .no_credit import run as no_credit
from .no_pack import self_check as no_pack
from .old_pack import self_check as old
from .separate_logs import self_check as logs
from .vault_credit import self_check as vault


def run() -> dict:
    return {
        "clean": clean()["credit"],
        "sandbox": no_credit()["reason"],
        "other": no_pack()["reason"],
        "old": old()["refused"],
        "abstain": abstain()["reason"],
        "vault": vault()["reason"],
        "logs": logs()["mixed_refused"],
        "missing": missing()["reason"],
        "paid": hundred()["paid"],
        "first_fail": hundred()["first_fail"],
        "action": "NO_EXECUTION",
    }


if __name__ == "__main__":
    print(json.dumps(run(), sort_keys=True))
