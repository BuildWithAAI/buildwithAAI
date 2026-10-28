"""Practice credit only if the pack replays clean.
"""
from __future__ import annotations

import json
from pathlib import Path

from .full_pack import replay
from .practice_settle import settle


def credit(path: Path, credits: int) -> dict:
    try:
        replay(path)
    except ValueError:
        return {"credited": False, "reason": "PACK_INCOMPLETE", "action": "NO_EXECUTION"}
    body = settle({"request_id": "req", "paid": True, "action": "NO_EXECUTION"}, credits)
    return {"credited": True, "after": body["credits_after"], "action": "NO_EXECUTION"}


def self_check() -> dict:
    path = Path("/tmp/aai-credit-pack.json")
    path.write_text(json.dumps({"slot": 1, "council": "WEIGHTED", "dispute": "UPHELD", "claim_sha256": "e" * 64}))
    return credit(path, 10_000_000)


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
