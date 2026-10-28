"""A sandbox reject blocks the hire.

Agreement from the other receipts does not override it.
"""
from __future__ import annotations

import json

from .receipt_council import vote


def vote_with_sandbox(features: tuple[float, float, float, float], rejected: bool) -> dict:
    decision = vote(features)
    if rejected:
        return {"hire_allowed": False, "reason": "SANDBOX_REJECT", "action": "NO_EXECUTION"}
    return decision


def self_check() -> dict:
    blocked = vote_with_sandbox((-0.2, -0.2, -0.2, 0.15), True)
    open_vote = vote_with_sandbox((-0.2, -0.2, -0.2, 0.15), False)
    if blocked["hire_allowed"] or not open_vote["hire_allowed"]:
        raise RuntimeError("SANDBOX_MISMATCH")
    return {"blocked": blocked["reason"], "open": open_vote["reason"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
