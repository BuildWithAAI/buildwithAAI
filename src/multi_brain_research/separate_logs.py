"""Fee log and claim log stay in different files.

A mix is refused.
"""
from __future__ import annotations

import json
from pathlib import Path


def check(path: Path, kind: str) -> dict:
    if kind == "fee" and "handle" in path.name:
        raise ValueError("MIXED_LOG")
    if kind == "claim" and "hash" in path.name:
        raise ValueError("MIXED_LOG")
    return {"kind": kind, "action": "NO_EXECUTION"}


def self_check() -> dict:
    try:
        check(Path("/tmp/handle-log.jsonl"), "fee")
    except ValueError:
        refused = True
    else:
        refused = False
    if not refused:
        raise RuntimeError("MIX_ALLOWED")
    return {"mixed_refused": refused, "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
