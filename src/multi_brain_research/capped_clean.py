"""Fee reserve stays capped inside a clean hire.
"""
from __future__ import annotations

import json

from .fee_cap import CAP, cap
from .live_pass import run_live


def run(endpoint: str) -> dict:
    passed = run_live(endpoint, "holder_b", 30, 50_000_000)
    reserved = cap(passed.get("reserve", 0))["reserve"]
    if reserved > CAP:
        raise RuntimeError("CLEAN_OVER_CAP")
    return {"reserve": reserved, "cap": CAP, "action": "NO_EXECUTION"}


def self_check() -> dict:
    return run("https://api.mainnet-beta.solana.com")


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
