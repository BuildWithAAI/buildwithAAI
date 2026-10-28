"""Pack must contain slot, council, dispute, and claim hash.
"""
from __future__ import annotations

import json
from pathlib import Path

REQUIRED = ("slot", "council", "dispute", "claim_sha256")


def replay(path: Path) -> dict:
    pack = json.loads(path.read_text())
    missing = [key for key in REQUIRED if not pack.get(key)]
    if missing:
        raise ValueError("PACK_INCOMPLETE")
    return {"complete": True, "action": "NO_EXECUTION"}


def self_check() -> dict:
    path = Path("/tmp/aai-full-pack.json")
    path.write_text(json.dumps({"slot": 1, "council": "WEIGHTED", "dispute": "UPHELD", "claim_sha256": "c" * 64}))
    good = replay(path)
    path.write_text(json.dumps({"slot": 1}))
    try:
        replay(path)
    except ValueError:
        refused = True
    else:
        refused = False
    if not good["complete"] or not refused:
        raise RuntimeError("FULL_PACK_MISMATCH")
    return {"complete": True, "incomplete_refused": refused, "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
