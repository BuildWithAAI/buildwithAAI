"""Real curve tape. Allowlisted RPC only. No send.
"""
from __future__ import annotations

import json
from pathlib import Path

from .curve_tape import capture
from .rpc_allow import ALLOWED


def row(endpoint: str, path: Path) -> dict:
    if endpoint not in ALLOWED:
        return {"labeled": False, "reason": "RPC_REFUSED", "action": "NO_EXECUTION"}
    body = capture(endpoint, path)
    body["labeled"] = True
    body["source"] = "ALLOWLISTED_RPC"
    return body


def self_check() -> dict:
    bad = row("https://evil.example", Path("/tmp/aai-bad-tape.jsonl"))
    if bad["labeled"]:
        raise RuntimeError("UNLISTED_LABELED")
    return {"reason": bad["reason"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
