"""Host capture script.

Follows research/HOST_CAPTURE.md. Read-only. One JSONL per mint.
A missing field is omitted. This script does not send.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from urllib.request import Request, build_opener

from .curve_decoder import decode_curve_event

TOKEN = "27RP3fkHt6T2QpCzsrJjk9oMZXAP5cya77VaR3UMpump"
CURVE = "Eq93BkkDVBLkjgHxZU6qVk7hrnzTnAyVfCNrXCVix1PL"
REQUIRED = ("mint", "curve_account", "virtual_reserves", "real_reserves", "fee_bps", "slot", "signature")
MAX_SIGNATURES = 1000


def _rpc(endpoint: str, method: str, params: list) -> dict:
    if not endpoint.startswith("https://") or method not in {"getAccountInfo", "getSignaturesForAddress", "getTransaction"}:
        raise ValueError("REFUSED")
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    request = Request(endpoint, data=body, headers={"Content-Type": "application/json"}, method="POST")
    with build_opener().open(request, timeout=20) as response:
        return json.loads(response.read(262144))


def capture_mint(endpoint: str, mint: str, curve: str, out: Path) -> dict:
    kept = omitted = 0
    signatures = _rpc(endpoint, "getSignaturesForAddress", [curve, {"limit": MAX_SIGNATURES, "commitment": "finalized"}])
    rows = []
    for item in signatures.get("result") or []:
        tx = _rpc(endpoint, "getTransaction", [item["signature"], {"commitment": "finalized", "maxSupportedTransactionVersion": 0}])
        event = (tx.get("result") or {}).get("meta", {}).get("curve_event")
        if not event or not all(key in event for key in REQUIRED) or event.get("mint") != mint:
            omitted += 1
            continue
        rows.append(decode_curve_event(event))
        kept += 1
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("".join(json.dumps(row, sort_keys=True) + "\n" for row in rows))
    return {"mint": mint, "kept": kept, "omitted": omitted, "action": "NO_EXECUTION"}


def main() -> int:
    endpoint = os.environ.get("RPC_URL", "")
    out = Path(os.environ.get("CAPTURE_OUT", "captures"))
    result = capture_mint(endpoint, TOKEN, CURVE, out / f"{TOKEN}.jsonl")
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
