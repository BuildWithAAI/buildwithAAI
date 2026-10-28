"""Dispute an admitted receipt and cut verification.

Funds stay unheld. Refund stays voluntary.
"""
from __future__ import annotations

import json

from .dispute_note import open_dispute, resolve


def dispute(verification: int) -> dict:
    note = open_dispute(
        "agent_a",
        "fly_hemibrain_adverse_v1",
        "admitted receipt was later contradicted by the tape",
        "d" * 64,
    )
    closed = resolve(note, True, verification)
    closed["funds_held"] = False
    return closed


def self_check() -> dict:
    closed = dispute(70)
    if closed["verification"] != 55 or closed["funds_held"]:
        raise RuntimeError("DISPUTE_MISMATCH")
    return {"status": closed["status"], "verification": closed["verification"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
