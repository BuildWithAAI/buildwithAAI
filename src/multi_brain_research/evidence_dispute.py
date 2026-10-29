"""Dispute from evidence.

An upheld dispute needs the pack it disputes. A bare flag does not cut a score.
"""
from __future__ import annotations

import json

from .dispute_decay import regate


def cut(score: int, pack: dict | None) -> dict:
    if not pack or not pack.get("pack_sha256"):
        return {"score": score, "reason": "NO_EVIDENCE", "action": "NO_EXECUTION"}
    return regate(score, True)


def self_check() -> dict:
    bare = cut(50, None)
    evidenced = cut(50, {"pack_sha256": "a" * 64})
    if bare["score"] != 50 or evidenced["score"] >= 50:
        raise RuntimeError("DISPUTE_EVIDENCE_MISMATCH")
    return {"bare": bare["reason"], "cut": evidenced["score"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
