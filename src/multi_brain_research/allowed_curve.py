"""Live curve read uses the allowlist.
"""
from __future__ import annotations

import json

from .live_curve import read_curve
from .rpc_allow import allow


def read(endpoint: str) -> dict:
    if not allow(endpoint, 49)["ok"]:
        return {"ok": False, "reason": "RPC_REFUSED", "action": "NO_EXECUTION"}
    body = read_curve(endpoint)
    body["ok"] = True
    return body


def self_check() -> dict:
    bad = read("https://evil.example")
    if bad["ok"]:
        raise RuntimeError("LIVE_ALLOW_MISMATCH")
    return {"reason": bad["reason"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
