"""Host capture script.

Follows research/HOST_CAPTURE.md. Read-only. One JSONL per mint.
A missing field is omitted. This script does not send.

Rows used to be dropped because getTransaction has no meta.curve_event.
Trades are read from Anchor "Program data" logs and kept only when the
pump.fun TradeEvent names this mint and the curve account is in the
transaction.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

from .curve_decoder import CurveError, decode_curve_event
from .public_rpc import post
from .pump_trade import decode_program_data
from .rpc_allow import ALLOWED

TOKEN = "27RP3fkHt6T2QpCzsrJjk9oMZXAP5cya77VaR3UMpump"
CURVE = "Eq93BkkDVBLkjgHxZU6qVk7hrnzTnAyVfCNrXCVix1PL"
MAX_SIGNATURES = 1000


def _account_keys(result: dict) -> list[str]:
    message = ((result.get("transaction") or {}).get("message") or {})
    found = []
    for key in message.get("accountKeys") or []:
        if type(key) is str:
            found.append(key)
        elif type(key) is dict and type(key.get("pubkey")) is str:
            found.append(key["pubkey"])
    loaded = (result.get("meta") or {}).get("loadedAddresses") or {}
    for bucket in ("writable", "readonly"):
        for key in loaded.get(bucket) or []:
            if type(key) is str:
                found.append(key)
    return found


def event_from_transaction(tx: dict, mint: str, curve: str, signature: str) -> dict | None:
    result = tx.get("result") if type(tx) is dict else None
    if type(result) is not dict:
        return None
    meta = result.get("meta")
    if type(meta) is not dict or meta.get("err") is not None:
        return None
    if curve not in _account_keys(result):
        return None
    slot = result.get("slot")
    if type(slot) is not int or slot < 0 or type(signature) is not str or not signature:
        return None
    logs = meta.get("logMessages")
    if type(logs) is not list:
        return None
    for line in logs:
        decoded = decode_program_data(line, mint)
        if decoded is None:
            continue
        return {
            "mint": mint,
            "curve_account": curve,
            "virtual_reserves": decoded["virtual_reserves"],
            "real_reserves": decoded["real_reserves"],
            "fee_bps": decoded["fee_bps"],
            "slot": slot,
            "signature": signature,
        }
    return None


def capture_mint(endpoint: str, mint: str, curve: str, out: Path, transport=None) -> dict:
    if endpoint not in ALLOWED:
        raise ValueError("REFUSED")

    def rpc(method: str, params: list) -> dict:
        if transport is not None:
            return transport(method, params)
        return post(endpoint, method, params)

    kept = omitted = 0
    signatures = rpc("getSignaturesForAddress", [curve, {"limit": MAX_SIGNATURES, "commitment": "finalized"}])
    rows = []
    for item in signatures.get("result") or []:
        if type(item) is not dict or type(item.get("signature")) is not str:
            omitted += 1
            continue
        signature = item["signature"]
        try:
            tx = rpc("getTransaction", [signature, {
                "commitment": "finalized",
                "maxSupportedTransactionVersion": 0,
                "encoding": "json",
            }])
        except (OSError, ValueError):
            omitted += 1
            continue
        event = event_from_transaction(tx, mint, curve, signature)
        if event is None:
            omitted += 1
            continue
        try:
            rows.append(decode_curve_event(event))
        except CurveError:
            omitted += 1
            continue
        kept += 1
    if out is not None:
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
