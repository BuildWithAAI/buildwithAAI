"""Decay an upheld dispute, then re-gate the hire.
"""
from __future__ import annotations

import json

from .reputation_gate import decay, gate


def regate(score: int, upheld: bool) -> dict:
    next_score = decay(score - 15, 1) if upheld else score
    return gate(next_score, 40)


def self_check() -> dict:
    blocked = regate(50, True)
    if blocked["hire_allowed"]:
        raise RuntimeError("DECAY_STILL_OPEN")
    return {"score": blocked["score"], "reason": blocked["reason"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
