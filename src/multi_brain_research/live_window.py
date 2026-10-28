"""Credit window uses the live slot, not a typed one.
"""
from __future__ import annotations

import json

from .credit_window import allow
from .live_curve import read_curve


def self_check() -> dict:
    live = read_curve("https://api.mainnet-beta.solana.com")["slot"]
    body = allow("https://api.mainnet-beta.solana.com", live)
    if not body["credited"]:
        raise RuntimeError("LIVE_NOT_CREDITED")
    return {"slot": live, "credited": True, "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
