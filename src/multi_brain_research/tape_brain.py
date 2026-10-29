"""The brain reads the tape.

A missing tape abstains.
"""
from __future__ import annotations

import json
from pathlib import Path


def read(path: Path) -> dict:
    if not path.exists() or not path.read_text().strip():
        return {"prediction_ppm": None, "reason": "NO_TAPE", "action": "NO_EXECUTION"}
    row = json.loads(path.read_text().splitlines()[-1])
    return {"prediction_ppm": 650_000, "slot": row["slot"], "action": "NO_EXECUTION"}


def self_check() -> dict:
    missing = read(Path("/tmp/aai-missing-tape.jsonl"))
    if missing["prediction_ppm"] is not None:
        raise RuntimeError("MISSING_TAPE_ANSWERED")
    return missing


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
