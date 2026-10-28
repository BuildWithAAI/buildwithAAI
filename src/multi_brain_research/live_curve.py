"""Live curve read for the functional pass.

Reads the Anything AI curve. A missing account fails closed. No send.
"""
from __future__ import annotations

import base64
import json
import struct
from urllib.request import Request, build_opener

CURVE = "Eq93BkkDVBLkjgHxZU6qVk7hrnzTnAyVfCNrXCVix1PL"
PUMP = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"


class CurveReadError(ValueError):
    pass


def read_curve(endpoint: str) -> dict:
    if not endpoint.startswith("https://"):
        raise CurveReadError("REFUSED")
    body = json.dumps({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "getAccountInfo",
        "params": [CURVE, {"encoding": "base64", "commitment": "finalized"}],
    }).encode()
    request = Request(endpoint, data=body, headers={"Content-Type": "application/json"}, method="POST")
    with build_opener().open(request, timeout=20) as response:
        payload = json.loads(response.read(262144))
    value = (payload.get("result") or {}).get("value")
    if not value or value.get("owner") != PUMP:
        raise CurveReadError("MISSING_CURVE")
    data = base64.b64decode(value["data"][0])
    virtual_base, virtual_quote, _, real_quote, _ = struct.unpack_from("<5Q", data, 8)
    return {
        "slot": payload["result"]["context"]["slot"],
        "real_quote": real_quote,
        "complete": bool(data[48]),
        "price": virtual_quote / virtual_base,
        "action": "NO_EXECUTION",
    }


def self_check() -> dict:
    body = read_curve("https://api.mainnet-beta.solana.com")
    if body["complete"] or body["real_quote"] < 0:
        raise CurveReadError("CURVE_MISMATCH")
    return {"slot": body["slot"], "real_quote": body["real_quote"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
