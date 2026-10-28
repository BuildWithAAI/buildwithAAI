"""Fee log stores the pack hash.

A repeat is refused.
"""
from __future__ import annotations

import json
from pathlib import Path

from .fee_log import append
from .fee_replay import replay


def log(path: Path, digest: str) -> dict:
    append(path, {"request_id": "req", "chain_sha256": digest, "paid": True, "action": "NO_EXECUTION"})
    return replay(path)


def self_check() -> dict:
    path = Path("/tmp/aai-hash-log.jsonl")
    if path.exists():
        path.unlink()
    good = log(path, "f" * 64)
    try:
        log(path, "f" * 64)
    except ValueError:
        refused = True
    else:
        refused = False
    if good["rows"] != 1 or not refused:
        raise RuntimeError("HASH_LOG_MISMATCH")
    return {"rows": good["rows"], "repeat_refused": refused, "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
