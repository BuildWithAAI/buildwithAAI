"""A matching dispute hash cuts the score.
"""
from __future__ import annotations

import json

from .dispute_hash import dispute


def self_check() -> dict:
    digest = "d" * 64
    body = dispute(50, {"pack_sha256": digest}, digest)
    if body["score"] >= 50:
        raise RuntimeError("MATCH_DID_NOT_CUT")
    return {"score": body["score"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
