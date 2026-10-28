"""Append the hire chain and refuse a repeat.

The log is local. No key is stored.
"""
from __future__ import annotations

import json
from pathlib import Path

from .fee_log import append
from .fee_replay import replay


def log_hire(path: Path, digest: str, paid: bool) -> dict:
    append(path, {"request_id": "req_receipt", "chain_sha256": digest, "paid": paid, "action": "NO_EXECUTION"})
    return replay(path)


def self_check() -> dict:
    path = Path("/tmp/aai-hire-log.jsonl")
    if path.exists():
        path.unlink()
    good = log_hire(path, "e" * 64, True)
    try:
        log_hire(path, "e" * 64, True)
    except ValueError:
        refused = True
    else:
        refused = False
    if good["rows"] != 1 or not refused:
        raise RuntimeError("LOG_MISMATCH")
    return {"rows": good["rows"], "repeat_refused": refused, "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
