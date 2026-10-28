"""Second @john inside the runner is refused.
"""
from __future__ import annotations

import json
from pathlib import Path

from .claim_log import ClaimLogError, append


def run(path: Path) -> dict:
    append(path, "@john")
    try:
        append(path, "@john")
    except ClaimLogError:
        return {"second": "REFUSED", "action": "NO_EXECUTION"}
    raise RuntimeError("SECOND_CLAIMED")


def self_check() -> dict:
    path = Path("/tmp/aai-john.jsonl")
    if path.exists():
        path.unlink()
    return run(path)


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
