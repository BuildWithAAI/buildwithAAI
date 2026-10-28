"""Claim log and reserved list in one call.
"""
from __future__ import annotations

import json
from pathlib import Path

from .claim_log import append


def run(path: Path) -> dict:
    free = append(path, "@mina")
    locked = append(path, "bitcoin")
    if not free["claimed"] or locked["reason"] != "RESERVED":
        raise RuntimeError("CLAIM_RESERVED_MISMATCH")
    return {"free": free["handle"], "locked": locked["reason"], "action": "NO_EXECUTION"}


def self_check() -> dict:
    path = Path("/tmp/aai-claim-reserved.jsonl")
    if path.exists():
        path.unlink()
    return run(path)


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
