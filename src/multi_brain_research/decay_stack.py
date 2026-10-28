"""Two upheld disputes cannot push a score below zero.
"""
from __future__ import annotations

import json

from .reputation_gate import penalize


def stack(score: int) -> dict:
    first = penalize(score, 15)
    second = penalize(first, 15)
    return {"score": second, "floor_held": second >= 0, "action": "NO_EXECUTION"}


def self_check() -> dict:
    body = stack(10)
    if body["score"] != 0 or not body["floor_held"]:
        raise RuntimeError("STACK_MISMATCH")
    return body


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
