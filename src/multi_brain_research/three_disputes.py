"""Three disputes on 50 stop at the floor the math allows.
"""
from __future__ import annotations

import json

from .dispute_hash import dispute


def self_check() -> dict:
    digest = "f" * 64
    score = 50
    for _ in range(3):
        score = dispute(score, {"pack_sha256": digest}, digest)["score"]
        if score < 0:
            raise RuntimeError("BELOW_ZERO")
    return {"score": score, "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
