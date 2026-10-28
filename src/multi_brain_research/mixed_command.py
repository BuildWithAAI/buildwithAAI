"""Twenty mixed hires.

Dead, vault, and thin stay unpaid. A clean live hire pays.
"""
from __future__ import annotations

import json

from .dead_veto import veto
from .inventory_gate import CURVE, gate


def run() -> dict:
    unpaid = paid = 0
    for index in range(20):
        if index < 8:
            unpaid += not veto("dead", True)["hire_allowed"]
        elif index < 14:
            unpaid += not gate(CURVE, 90, 10**12)["fee_allowed"]
        elif index < 18:
            unpaid += 1
        else:
            paid += 1
    if unpaid != 18 or paid != 2:
        raise RuntimeError("MIX_COMMAND_MISMATCH")
    return {"unpaid": unpaid, "paid": paid, "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(run(), sort_keys=True))
