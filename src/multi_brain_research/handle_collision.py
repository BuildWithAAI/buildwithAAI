"""Handle collision.

The same handle cannot be claimed twice. Reserved names stay locked.
"""
from __future__ import annotations

import json

from .handle_claim import claim


class CollisionError(ValueError):
    pass


def claim_once(name: str, taken: set[str]) -> dict:
    body = claim(name)
    if not body["claimed"]:
        return body
    if body["handle"] in taken:
        return {"handle": body["handle"], "claimed": False, "reason": "TAKEN", "chain": False}
    taken.add(body["handle"])
    return body


def self_check() -> dict:
    taken: set[str] = set()
    first = claim_once("@john", taken)
    second = claim_once("john", taken)
    locked = claim_once("solana", taken)
    if not first["claimed"] or second["reason"] != "TAKEN" or locked["reason"] != "RESERVED":
        raise CollisionError("COLLISION_MISMATCH")
    return {"first": first["handle"], "second": second["reason"], "locked": locked["reason"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
