"""Fail closed.

A non-HTTPS endpoint and a reserved handle refuse before any write.
"""
from __future__ import annotations

import json
from pathlib import Path

from .claim_log import append
from .live_curve import CurveReadError, read_curve


def check(endpoint: str, handle: str, path: Path) -> dict:
    wrote = False
    try:
        read_curve(endpoint)
    except CurveReadError as err:
        curve = str(err)
    else:
        curve = "READ"
    claim = append(path, handle)
    if claim.get("claimed"):
        wrote = True
    if curve != "REFUSED" or wrote:
        raise RuntimeError("NOT_CLOSED")
    return {"curve": curve, "handle": claim["reason"], "wrote": wrote, "action": "NO_EXECUTION"}


def self_check() -> dict:
    return check("fixture://local", "solana", Path("/tmp/aai-closed.jsonl"))


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
