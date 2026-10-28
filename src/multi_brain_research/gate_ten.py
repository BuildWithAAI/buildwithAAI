"""One command for these ten steps.
"""
from __future__ import annotations

import json

from .capped_reserve import self_check as cap
from .full_pack import self_check as pack
from .gated_agents import run as agents
from .graduated_pay import self_check as graduated
from .missing_curve import run as missing
from .other_mint import self_check as other
from .sandbox_override import run as sandbox
from .second_claim import self_check as second
from .unpaid_kinds import self_check as kinds


def run() -> dict:
    return {
        "missing": missing()["reason"],
        "sandbox": sandbox()["reason"],
        "second": second()["second"],
        "pack": pack()["complete"],
        "kinds": kinds()["blocked"],
        "reserve": cap()["reserve"],
        "graduated": graduated()["reason"],
        "other": other()["reason"],
        "paid": agents()["paid"],
        "action": "NO_EXECUTION",
    }


if __name__ == "__main__":
    print(json.dumps(run(), sort_keys=True))
