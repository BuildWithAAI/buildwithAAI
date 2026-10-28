"""Other AAI mint writes no pack.
"""
from __future__ import annotations

import json
from pathlib import Path

from .other_mint import OTHER, hire


def run(path: Path) -> dict:
    body = hire(OTHER)
    if body["fee_status"] == "PAID":
        raise RuntimeError("OTHER_PACKED")
    if path.exists():
        path.unlink()
    return {"packed": path.exists(), "reason": body["reason"], "action": "NO_EXECUTION"}


def self_check() -> dict:
    return run(Path("/tmp/aai-other-pack.json"))


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
