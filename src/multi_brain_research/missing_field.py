"""One missing pack field blocks credit and hash.
"""
from __future__ import annotations

import json
from pathlib import Path

from .clean_credit import credit


def run(path: Path) -> dict:
    path.write_text(json.dumps({"slot": 1, "council": "WEIGHTED"}))
    body = credit(path, 10_000_000)
    if body["credited"]:
        raise RuntimeError("MISSING_CREDITED")
    return {"credited": False, "hashed": False, "reason": body["reason"], "action": "NO_EXECUTION"}


def self_check() -> dict:
    return run(Path("/tmp/aai-missing-field.json"))


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
