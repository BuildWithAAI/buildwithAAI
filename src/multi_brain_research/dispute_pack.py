"""Dispute pack.

An upheld dispute must be in the pack or replay fails.
"""
from __future__ import annotations

import json
from pathlib import Path


def replay(path: Path) -> dict:
    pack = json.loads(path.read_text())
    dispute = pack.get("dispute") or {}
    if dispute.get("status") != "UPHELD":
        raise ValueError("DISPUTE_MISSING")
    return {"complete": True, "action": "NO_EXECUTION"}


def self_check() -> dict:
    path = Path("/tmp/aai-dispute-pack.json")
    path.write_text(json.dumps({"dispute": {"status": "UPHELD"}}))
    good = replay(path)
    path.write_text(json.dumps({"dispute": {"status": "OPEN"}}))
    try:
        replay(path)
    except ValueError:
        refused = True
    else:
        refused = False
    if not good["complete"] or not refused:
        raise RuntimeError("DISPUTE_PACK_MISMATCH")
    return {"complete": True, "open_refused": refused, "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
