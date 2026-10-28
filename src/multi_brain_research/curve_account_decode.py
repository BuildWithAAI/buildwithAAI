"""Decode the saved Anything AI curve account.

Known pump.fun fields are read. The tail is marked unparsed.
Nothing is invented and nothing is sent.
"""
from __future__ import annotations

import base64
import json
import struct
from pathlib import Path

CURVE = "Eq93BkkDVBLkjgHxZU6qVk7hrnzTnAyVfCNrXCVix1PL"
PUMP = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"


def decode(raw_account: dict) -> dict:
    value = (raw_account.get("result") or {}).get("value") or {}
    if value.get("owner") != PUMP:
        raise ValueError("NOT_PUMP_CURVE")
    data = base64.b64decode(value["data"][0])
    if len(data) < 49:
        raise ValueError("ACCOUNT_TOO_SHORT")
    virtual_base, virtual_quote, real_base, real_quote, supply = struct.unpack_from("<5Q", data, 8)
    return {
        "curve": CURVE,
        "owner": PUMP,
        "virtual_reserves": {"base": virtual_base, "quote": virtual_quote},
        "real_reserves": {"base": real_base, "quote": real_quote},
        "supply": supply,
        "complete": bool(data[48]),
        "unparsed_tail_bytes": len(data) - 49,
        "missing": ["fee_bps", "signature", "slot"],
        "classification": "ACCOUNT_DECODE_NOT_A_TRADE",
        "action": "NO_EXECUTION",
    }


def self_check() -> dict:
    decoded = decode(json.loads(Path("/tmp/curve-account.json").read_text()))
    if decoded["complete"] or decoded["real_reserves"]["quote"] != 71:
        raise RuntimeError("DECODE_MISMATCH")
    return decoded


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
