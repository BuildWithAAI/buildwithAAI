"""Curve history.

Store slot, reserves, and price. The brain can read the tape. No send.
"""
from __future__ import annotations

import json
from pathlib import Path

from .live_curve import read_curve
from .rpc_allow import ALLOWED


def capture(endpoint: str, path: Path) -> dict:
    if endpoint not in ALLOWED:
        raise ValueError("RPC_REFUSED")
    curve = read_curve(endpoint)
    row = {"slot": curve["slot"], "real_quote": curve["real_quote"], "price": curve["price"], "action": "NO_EXECUTION"}
    with path.open("a") as handle:
        handle.write(json.dumps(row) + "\n")
    return row


def self_check() -> dict:
    path = Path("/tmp/aai-tape.jsonl")
    if path.exists():
        path.unlink()
    row = capture("https://api.mainnet-beta.solana.com", path)
    if row["real_quote"] < 0:
        raise RuntimeError("TAPE_MISMATCH")
    return {"slot": row["slot"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
