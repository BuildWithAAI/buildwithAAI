"""The fee rate goes in the pack.

Replay fails if bps is missing.
"""
from __future__ import annotations

import json
from pathlib import Path

from .live_fee import run


def write(path: Path, body: dict) -> dict:
    pack = {
        "slot": body.get("slot"),
        "bps": body.get("bps"),
        "reserve": body.get("reserve"),
        "action": "NO_EXECUTION",
    }
    path.write_text(json.dumps(pack, sort_keys=True))
    return pack


def replay(path: Path) -> dict:
    pack = json.loads(path.read_text())
    if pack.get("bps") not in (100, 250):
        raise ValueError("BPS_MISSING")
    return {"complete": True, "bps": pack["bps"], "action": "NO_EXECUTION"}


def self_check() -> dict:
    path = Path("/tmp/aai-bps-pack.json")
    body = run("https://api.mainnet-beta.solana.com", "holder_b", 30, 50_000_000)
    write(path, body)
    good = replay(path)
    path.write_text(json.dumps({"slot": body.get("slot")}))
    try:
        replay(path)
    except ValueError:
        refused = True
    else:
        refused = False
    if good["bps"] != 100 or not refused:
        raise RuntimeError("BPS_PACK_MISMATCH")
    return {"bps": good["bps"], "missing_refused": refused, "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
