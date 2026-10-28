"""Replay a stored pack and refuse a new slot.
"""
from __future__ import annotations

import json
from pathlib import Path


def replay(path: Path, current_slot: int) -> dict:
    pack = json.loads(path.read_text())
    if pack["slot"] != current_slot:
        raise ValueError("SLOT_MOVED")
    return {"complete": True, "action": "NO_EXECUTION"}


def self_check() -> dict:
    path = Path("/tmp/aai-old-pack.json")
    path.write_text(json.dumps({"slot": 462609965}))
    try:
        replay(path, 462609965 + 10)
    except ValueError:
        refused = True
    else:
        refused = False
    if not refused:
        raise RuntimeError("OLD_SLOT_PASSED")
    return {"refused": refused, "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
