"""Append-only fee log.

Each chain hash is one line. A later audit can replay the order.
The log does not contain a key or a signature.
"""
from __future__ import annotations

import json
from pathlib import Path


class LogError(ValueError):
    pass


def append(path: Path, linked: dict) -> dict:
    if linked.get("action") != "NO_EXECUTION" or not linked.get("chain_sha256"):
        raise LogError("BAD_CHAIN")
    line = json.dumps({
        "request_id": linked["request_id"],
        "chain_sha256": linked["chain_sha256"],
        "paid": bool(linked.get("paid")),
    }, sort_keys=True)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(line + "\n")
    return {"path": str(path), "appended": True, "action": "NO_EXECUTION"}


def replay(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    return [json.loads(line) for line in path.read_text().splitlines() if line]


def self_check() -> dict:
    path = Path("/tmp/aai-fee-log.jsonl")
    if path.exists():
        path.unlink()
    append(path, {"request_id": "req_pass_1", "chain_sha256": "a" * 64, "paid": True, "action": "NO_EXECUTION"})
    append(path, {"request_id": "req_pass_2", "chain_sha256": "b" * 64, "paid": False, "action": "NO_EXECUTION"})
    rows = replay(path)
    if len(rows) != 2 or rows[1]["paid"]:
        raise LogError("LOG_MISMATCH")
    return {"rows": len(rows), "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
