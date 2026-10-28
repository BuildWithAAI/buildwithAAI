"""Sandbox hire gets no credit.
"""
from __future__ import annotations

import json
from pathlib import Path

from .clean_credit import credit


def run() -> dict:
    path = Path("/tmp/aai-no-credit.json")
    path.write_text(json.dumps({"slot": 1}))
    body = credit(path, 10_000_000)
    if body["credited"]:
        raise RuntimeError("SANDBOX_CREDITED")
    return body


if __name__ == "__main__":
    print(json.dumps(run(), sort_keys=True))
