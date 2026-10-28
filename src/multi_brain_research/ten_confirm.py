"""Confirm the ten-step runner finished without execution.
"""
from __future__ import annotations

import json
from pathlib import Path

from .ten_step import run


def confirm() -> dict:
    path = Path("/tmp/aai-ten-confirm.jsonl")
    if path.exists():
        path.unlink()
    result = run(Path("/tmp/hemibrain.json"), path)
    if result["action"] != "NO_EXECUTION" or result["market_skill"] != "NOT_ESTABLISHED":
        raise RuntimeError("TEN_NOT_CLOSED")
    return {"steps": 10, "closed": True, **result}


if __name__ == "__main__":
    print(json.dumps(confirm(), sort_keys=True))
