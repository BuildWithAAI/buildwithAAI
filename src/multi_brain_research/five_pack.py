"""Matching 5,000 reserve writes a signed pack.
"""
from __future__ import annotations

import json
from pathlib import Path

from .pass_pack import write


def self_check() -> dict:
    body = write(Path("/tmp/aai-5000-pack.json"), 1, 5_000)
    if not body["complete"]:
        raise RuntimeError("FIVE_PACK_MISMATCH")
    return {"reserve": 5_000, "complete": True, "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
