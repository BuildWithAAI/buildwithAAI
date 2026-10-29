"""Allowlist plus a short account fails before decode.
"""
from __future__ import annotations

import json

from .rpc_allow import allow


def self_check() -> dict:
    body = allow("https://api.mainnet-beta.solana.com", 8)
    if body["ok"]:
        raise RuntimeError("SHORT_DECODED")
    return body


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
