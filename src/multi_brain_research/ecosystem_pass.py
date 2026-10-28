"""One pass of the agentic layer.

Register specialists, gate a hire, shape a job offer, open and resolve a
dispute. No wallet. No settlement.
"""
from __future__ import annotations

import json

from .dispute_note import open_dispute, resolve
from .reputation_gate import decay, gate
from .research_offer import offer
from .specialist_registry import register


def pass_once() -> dict:
    registry = register()
    score = decay(80, 1)
    decision = gate(score, 40)
    body = offer(registry, "fly_hemibrain_adverse_v1", "agent_a", "req_joint_1") if decision["hire_allowed"] else None
    note = open_dispute("agent_a", "fly_hemibrain_adverse_v1", "later tape contradicted the receipt", "c" * 64)
    closed = resolve(note, False, score)
    return {
        "specialists": registry["count"],
        "gate": decision,
        "offer": body,
        "dispute": closed,
        "market_skill": "NOT_ESTABLISHED",
        "action": "NO_EXECUTION",
    }


if __name__ == "__main__":
    print(json.dumps(pass_once(), sort_keys=True))
