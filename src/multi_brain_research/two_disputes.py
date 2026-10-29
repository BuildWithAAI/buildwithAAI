"""Two matching disputes stop at zero, not below.
"""
from __future__ import annotations

import json

from .decay_stack import stack
from .dispute_hash import dispute


def twice() -> dict:
    cut = dispute(50, {"pack_sha256": "e" * 64}, "e" * 64)
    floored = stack(5)
    if cut["score"] >= 50 or floored["score"] < 0:
        raise RuntimeError("DISPUTE_FLOOR_MISMATCH")
    return {"cut": cut["score"], "floor": floored["score"], "action": "NO_EXECUTION"}


def self_check() -> dict:
    return twice()


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
