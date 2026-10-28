"""Claim log.

Append each claim. A replay refuses a repeated handle.
"""
from __future__ import annotations

import json
from pathlib import Path

from .handle_claim import claim


class ClaimLogError(ValueError):
    pass


def append(path: Path, name: str) -> dict:
    body = claim(name)
    if not body["claimed"]:
        return body
    seen = set()
    if path.exists():
        seen = {json.loads(line)["handle"] for line in path.read_text().splitlines() if line}
    if body["handle"] in seen:
        raise ClaimLogError("REPEATED_HANDLE")
    with path.open("a") as handle:
        handle.write(json.dumps(body, sort_keys=True) + "\n")
    return body


def self_check() -> dict:
    path = Path("/tmp/aai-claims.jsonl")
    if path.exists():
        path.unlink()
    first = append(path, "@john")
    try:
        append(path, "john")
    except ClaimLogError:
        refused = True
    else:
        refused = False
    if not first["claimed"] or not refused:
        raise ClaimLogError("LOG_MISMATCH")
    return {"first": first["handle"], "repeat_refused": refused, "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
