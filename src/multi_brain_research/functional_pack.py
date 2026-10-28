"""Receipt pack for the functional pass.

Replay fails if slot, council, or claim hash is missing.
"""
from __future__ import annotations

import json
from pathlib import Path


def write_pack(path: Path, slot: int, council: str, claim_hash: str) -> dict:
    pack = {"slot": slot, "council": council, "claim_sha256": claim_hash, "action": "NO_EXECUTION"}
    path.write_text(json.dumps(pack, sort_keys=True))
    return pack


def replay(path: Path) -> dict:
    pack = json.loads(path.read_text())
    missing = [key for key in ("slot", "council", "claim_sha256") if not pack.get(key)]
    if missing:
        raise ValueError("PACK_MISSING")
    return {"complete": True, "action": "NO_EXECUTION"}


def self_check() -> dict:
    path = Path("/tmp/aai-fn-pack.json")
    write_pack(path, 462599136, "WEIGHTED", "a" * 64)
    good = replay(path)
    path.write_text(json.dumps({"slot": 1}))
    try:
        replay(path)
    except ValueError:
        refused = True
    else:
        refused = False
    if not good["complete"] or not refused:
        raise RuntimeError("PACK_MISMATCH")
    return {"complete": True, "missing_refused": refused, "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
