"""Run a dead-coin row through the hire steps.

Dead does not get a free pass. It still needs consensus and a hold.
"""
from __future__ import annotations

import json

from .dead_coins import fixtures
from .two_receipt_consensus import consensus


def run_dead() -> dict:
    coin = fixtures()["coins"][0]
    first = {"prediction_ppm": 700_000, "action": "NO_EXECUTION"}
    second = {"prediction_ppm": 650_000, "action": "NO_EXECUTION"}
    agreed = consensus(first, second)
    return {"mint": coin["mint"], "reason": coin["reason"], "hire_allowed": agreed["hire_allowed"], "action": "NO_EXECUTION"}


def self_check() -> dict:
    body = run_dead()
    if not body["hire_allowed"] or "dead" not in body["mint"]:
        raise RuntimeError("DEAD_MISMATCH")
    return body


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
