"""A pack with a reserved handle fails replay.
"""
from __future__ import annotations

import json
from pathlib import Path

from .handle_claim import RESERVED


def replay(path: Path) -> dict:
    pack = json.loads(path.read_text())
    if pack.get("handle") in RESERVED:
        raise ValueError("RESERVED_IN_PACK")
    return {"complete": True, "action": "NO_EXECUTION"}


def self_check() -> dict:
    path = Path("/tmp/aai-reserved-replay.json")
    path.write_text(json.dumps({"handle": "solana"}))
    try:
        replay(path)
    except ValueError:
        refused = True
    else:
        refused = False
    if not refused:
        raise RuntimeError("RESERVED_REPLAYED")
    return {"refused": refused, "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
