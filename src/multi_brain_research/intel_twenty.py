"""One command for the next ten intelligence steps.
"""
from __future__ import annotations

import json
from pathlib import Path

from .board_history import push
from .capped_inventory import pay
from .consensus_stress import stress
from .cooldown_window import allow
from .dead_veto import veto
from .dispute_pack import replay
from .inventory_gate import CURVE
from .safe_pack import write_safe
from .third_brain import third
from .weighted_consensus import weigh


def run() -> dict:
    no_trade = third((-0.2, -0.2, -0.2, 0.15))
    weighed = weigh([
        {"prediction_ppm": 900_000, "verification": 10},
        {"prediction_ppm": 200_000, "verification": 70},
        {"prediction_ppm": no_trade["prediction_ppm"], "verification": 100},
    ])
    dead = veto("dead", True)
    history = push([], {"specialist_id": "fly", "verification": 55, "secret": "no"})
    unpaid = pay(CURVE, 90, 10**12, 500_000)
    window = allow("agent_a", "agent_a")
    path = Path("/tmp/aai-intel2.json")
    write_safe(path, {"dispute": {"status": "UPHELD"}, "private_key": "no"})
    packed = replay(path)
    stressed = stress()
    return {
        "third_abstained": no_trade["prediction_ppm"] is None,
        "loud_lost": not weighed["hire_allowed"],
        "dead": dead["reason"],
        "history": len(history),
        "vault_unpaid": unpaid["reason"],
        "cooldown": window["reason"],
        "pack": packed["complete"],
        "unpaid": stressed["unpaid"],
        "market_skill": "NOT_ESTABLISHED",
        "action": "NO_EXECUTION",
    }


if __name__ == "__main__":
    print(json.dumps(run(), sort_keys=True))
