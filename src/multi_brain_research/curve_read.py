"""One read-only fetch of the Anything AI curve account.

Saves the raw account. Refuses any other account and any send.
"""
from __future__ import annotations

import json
from pathlib import Path

from .public_rpc import post
from .rpc_allow import ALLOWED

CURVE = "Eq93BkkDVBLkjgHxZU6qVk7hrnzTnAyVfCNrXCVix1PL"
PUMP = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"


def read_curve(endpoint: str, out: Path) -> dict:
    if endpoint not in ALLOWED:
        raise ValueError("REFUSED")
    payload = post(endpoint, "getAccountInfo", [CURVE, {"encoding": "base64", "commitment": "finalized"}])
    value = (payload.get("result") or {}).get("value") or {}
    if value.get("owner") != PUMP:
        raise ValueError("NOT_PUMP_CURVE")
    record = {
        "curve": CURVE,
        "owner": value.get("owner"),
        "lamports": value.get("lamports"),
        "slot": (payload.get("result") or {}).get("context", {}).get("slot"),
        "executable": False,
        "action": "NO_EXECUTION",
    }
    out.write_text(json.dumps(record, sort_keys=True))
    return record


if __name__ == "__main__":
    print(json.dumps(read_curve("https://api.mainnet-beta.solana.com", Path("/tmp/aai-curve.json")), sort_keys=True))
