"""A chain-read source pays the same as a signed snapshot.
"""
from __future__ import annotations

import json

from .receipt_pass import run_with_receipt


def self_check() -> dict:
    receipt = {"source": "CHAIN_READ", "held_days": 30, "atoms": 50_000_000}
    body = run_with_receipt("https://api.mainnet-beta.solana.com", "holder_b", receipt)
    if body.get("bps") != 100:
        raise RuntimeError("CHAIN_READ_NOT_PAID")
    return {"bps": body["bps"], "source": "CHAIN_READ", "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
