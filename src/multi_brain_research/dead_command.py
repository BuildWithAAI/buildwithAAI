"""Dead coin in the command.

Refused before the fee splits.
"""
from __future__ import annotations

import json

from .dead_veto import veto


def run_dead() -> dict:
    decision = veto("dead", True)
    if decision["hire_allowed"]:
        raise RuntimeError("DEAD_PAID")
    return {"fee_status": "UNPAID", "reason": decision["reason"], "split": False, "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(run_dead(), sort_keys=True))
