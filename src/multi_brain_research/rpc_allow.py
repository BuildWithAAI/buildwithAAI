"""RPC allowlist and a length check.

Only the known mainnet endpoint. A short account fails closed.
"""
from __future__ import annotations

import json

ALLOWED = {"https://api.mainnet-beta.solana.com"}
MIN_LEN = 49


def allow(endpoint: str, data_len: int) -> dict:
    if endpoint not in ALLOWED:
        return {"ok": False, "reason": "RPC_REFUSED", "action": "NO_EXECUTION"}
    if data_len < MIN_LEN:
        return {"ok": False, "reason": "SHORT_ACCOUNT", "action": "NO_EXECUTION"}
    return {"ok": True, "action": "NO_EXECUTION"}


def self_check() -> dict:
    bad = allow("https://evil.example", 80)
    short = allow("https://api.mainnet-beta.solana.com", 8)
    if bad["ok"] or short["ok"]:
        raise RuntimeError("ALLOWLIST_MISMATCH")
    return {"rpc": bad["reason"], "short": short["reason"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
