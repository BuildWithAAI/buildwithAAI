"""The live pass writes the signed pack.
"""
from __future__ import annotations

import json
from pathlib import Path

from .signed_pack import replay, sign


def write(path: Path, slot: int, reserve: int) -> dict:
    pack = {
        "slot": slot,
        "council": "WEIGHTED",
        "bps": 100,
        "reserve": reserve,
        "claim_sha256": "c" * 64,
        "action": "NO_EXECUTION",
    }
    pack["pack_sha256"] = sign(pack)
    path.write_text(json.dumps(pack, sort_keys=True))
    return replay(path.read_text() and json.loads(path.read_text()))


def self_check() -> dict:
    body = write(Path("/tmp/aai-signed-live.json"), 1, 500_000)
    if not body["complete"]:
        raise RuntimeError("SIGNED_LIVE_MISMATCH")
    return body


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
