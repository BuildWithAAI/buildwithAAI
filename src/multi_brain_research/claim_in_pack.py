"""Handle claim receipt goes in the pack.
"""
from __future__ import annotations

import json
from pathlib import Path

from .handle_claim import claim


def pack(path: Path, name: str) -> dict:
    body = claim(name)
    if not body["claimed"]:
        raise RuntimeError("NOT_CLAIMED")
    path.write_text(json.dumps({"claim_sha256": body["receipt_sha256"], "handle": body["handle"], "action": "NO_EXECUTION"}))
    return {"written": True, "handle": body["handle"], "action": "NO_EXECUTION"}


def self_check() -> dict:
    return pack(Path("/tmp/aai-claim-pack.json"), "@rio")


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
