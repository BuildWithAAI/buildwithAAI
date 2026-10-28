"""Reserved handle cannot enter the pack.
"""
from __future__ import annotations

import json
from pathlib import Path

from .handle_claim import claim


def pack(path: Path, name: str) -> dict:
    body = claim(name)
    if not body["claimed"]:
        return {"written": False, "reason": body["reason"], "action": "NO_EXECUTION"}
    path.write_text(json.dumps(body))
    return {"written": True, "action": "NO_EXECUTION"}


def self_check() -> dict:
    body = pack(Path("/tmp/aai-reserved-pack.json"), "solana")
    if body["written"]:
        raise RuntimeError("RESERVED_PACKED")
    return body


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
