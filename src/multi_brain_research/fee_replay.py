"""Replay a fee log and refuse a broken chain.

Rows must be in order. A repeated hash or a missing hash fails.
"""
from __future__ import annotations

import json
from pathlib import Path


class ReplayError(ValueError):
    pass


def replay(path: Path) -> dict:
    rows = [json.loads(line) for line in path.read_text().splitlines() if line]
    seen = set()
    for row in rows:
        digest = row.get("chain_sha256")
        if type(digest) is not str or len(digest) != 64 or digest in seen:
            raise ReplayError("BROKEN_CHAIN")
        seen.add(digest)
    return {"rows": len(rows), "unique": len(seen), "action": "NO_EXECUTION"}


def self_check() -> dict:
    path = Path("/tmp/aai-replay.jsonl")
    path.write_text(
        json.dumps({"request_id": "a", "chain_sha256": "a" * 64, "paid": True}) + "\n"
        + json.dumps({"request_id": "b", "chain_sha256": "b" * 64, "paid": False}) + "\n"
    )
    good = replay(path)
    path.write_text(
        json.dumps({"request_id": "a", "chain_sha256": "a" * 64}) + "\n"
        + json.dumps({"request_id": "a", "chain_sha256": "a" * 64}) + "\n"
    )
    try:
        replay(path)
    except ReplayError:
        refused = True
    else:
        refused = False
    if good["rows"] != 2 or not refused:
        raise ReplayError("REPLAY_MISMATCH")
    return {"rows": good["rows"], "broken_refused": refused, "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
