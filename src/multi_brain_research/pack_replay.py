"""Replay an evidence pack.

A missing piece is refused.
"""
from __future__ import annotations

import json
from pathlib import Path

REQUIRED = ("tape", "receipt", "dispute", "chain_sha256")


def replay(path: Path) -> dict:
    pack = json.loads(path.read_text())
    missing = [key for key in REQUIRED if key not in pack or pack[key] in (None, "")]
    if missing:
        raise ValueError("MISSING_PIECE")
    return {"complete": True, "missing": [], "action": "NO_EXECUTION"}


def self_check() -> dict:
    path = Path("/tmp/aai-pack-replay.json")
    path.write_text(json.dumps({"tape": {}, "receipt": {}, "dispute": {}, "chain_sha256": "f" * 64}))
    good = replay(path)
    path.write_text(json.dumps({"tape": {}}))
    try:
        replay(path)
    except ValueError:
        refused = True
    else:
        refused = False
    if not good["complete"] or not refused:
        raise RuntimeError("REPLAY_MISMATCH")
    return {"complete": True, "missing_refused": refused, "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
