"""Reserved handle in the command.

Refused before a log write.
"""
from __future__ import annotations

import json
from pathlib import Path

from .claim_log import append


def run(path: Path) -> dict:
    before = path.read_text() if path.exists() else ""
    body = append(path, "solana")
    after = path.read_text() if path.exists() else ""
    if body["claimed"] or after != before:
        raise RuntimeError("RESERVED_WROTE")
    return {"reason": body["reason"], "wrote": False, "action": "NO_EXECUTION"}


def self_check() -> dict:
    return run(Path("/tmp/aai-reserved.jsonl"))


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
