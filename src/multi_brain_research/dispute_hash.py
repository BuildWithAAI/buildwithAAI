"""Dispute hash must match the signed pack.
"""
from __future__ import annotations

import json

from .evidence_dispute import cut


def dispute(score: int, pack: dict, claimed: str) -> dict:
    if pack.get("pack_sha256") != claimed:
        return {"score": score, "reason": "HASH_MISMATCH", "action": "NO_EXECUTION"}
    return cut(score, pack)


def self_check() -> dict:
    pack = {"pack_sha256": "a" * 64}
    body = dispute(50, pack, "b" * 64)
    if body["score"] != 50:
        raise RuntimeError("MISMATCH_CUT")
    return body


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
