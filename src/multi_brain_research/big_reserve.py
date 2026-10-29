"""A 500,000 pack reserve fails against the 5,000 schedule.
"""
from __future__ import annotations

import json

from .one_fee_pass import run


def self_check() -> dict:
    receipt = {"source": "SIGNED_SNAPSHOT", "held_days": 30, "atoms": 50_000_000}
    body = run("https://api.mainnet-beta.solana.com", "holder_b", receipt, 500_000, 10_000)
    if body["reason"] != "RESERVE_MISMATCH":
        raise RuntimeError("BIG_RESERVE_PAID")
    return body


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
