"""A signed 30-day snapshot pays 100 bps.
"""
from __future__ import annotations

import json

from .receipt_pass import run_with_receipt


def self_check() -> dict:
    receipt = {"source": "SIGNED_SNAPSHOT", "held_days": 30, "atoms": 50_000_000}
    body = run_with_receipt("https://api.mainnet-beta.solana.com", "holder_b", receipt)
    if body.get("bps") != 100:
        raise RuntimeError("SNAPSHOT_NOT_PAID")
    return {"bps": body["bps"], "reserve": body["reserve"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
