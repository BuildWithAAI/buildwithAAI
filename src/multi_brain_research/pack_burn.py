"""Burn mark only if the pack replays.
"""
from __future__ import annotations

import json
from pathlib import Path

from .burn_receipt import receipt
from .full_pack import replay
from .inventory_gate import TOKEN


def mark(path: Path) -> dict:
    try:
        replay(path)
    except ValueError:
        return {"reason": "PACK_INCOMPLETE", "burn_executed": False, "action": "NO_EXECUTION"}
    body = receipt({"request_id": "req", "token": TOKEN, "buyback_reserve_lamports": 500_000, "action": "NO_EXECUTION"}, 500_000)
    return {"reason": body["reason"], "burn_executed": body["burn_executed"], "action": "NO_EXECUTION"}


def self_check() -> dict:
    path = Path("/tmp/aai-burn-pack.json")
    path.write_text(json.dumps({"slot": 1, "council": "WEIGHTED", "dispute": "UPHELD", "claim_sha256": "a" * 64}))
    body = mark(path)
    if body["burn_executed"]:
        raise RuntimeError("BURN_SENT")
    return body


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
