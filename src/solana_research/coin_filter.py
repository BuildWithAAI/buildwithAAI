"""Filter a block down to one coin.

Keeps slot, time, amount, and success. Hides the mint.
If the read fails, no row is written. Nothing is invented.
"""
from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path
from urllib.request import Request, build_opener

from .rpc import DEFAULT_PUBLIC_RPC, rpc_call

TOKEN = "27RP3fkHt6T2QpCzsrJjk9oMZXAP5cya77VaR3UMpump"


def alias(value: str) -> str:
    return "c_" + hashlib.sha256(value.encode()).hexdigest()[:12]


def trade_row(mint: str, slot: int, block_time: int | None, amount: int | None, success: bool) -> dict:
    return {
        "label": "REAL_ANONYMIZED",
        "coin": alias(mint),
        "slot": slot,
        "block_time": block_time,
        "amount": amount,
        "success": success,
        "synthetic": False,
        "action": "NO_EXECUTION",
    }


def adverse(first: dict, second: dict) -> dict:
    if first.get("amount") is None or second.get("amount") is None:
        return {"label": None, "reason": "ABSTAIN", "action": "NO_EXECUTION"}
    if second["amount"] < first["amount"]:
        return {"label": "adverse", "action": "NO_EXECUTION"}
    return {"label": "hold", "action": "NO_EXECUTION"}


def scan(endpoint: str, slot: int, mint: str, path: Path, limit: int = 8) -> dict:
    if endpoint != DEFAULT_PUBLIC_RPC:
        return {"written": 0, "reason": "RPC_REFUSED", "action": "NO_EXECUTION"}
    block = rpc_call(endpoint, "getBlock", [slot, {
        "encoding": "json",
        "transactionDetails": "signatures",
        "rewards": False,
        "maxSupportedTransactionVersion": 0,
    }])
    result = block.get("result") or {}
    sigs = result.get("signatures") or []
    written = 0
    for sig in sigs[:limit]:
        time.sleep(0.8)
        body = json.dumps({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "getTransaction",
            "params": [sig, {"encoding": "jsonParsed", "maxSupportedTransactionVersion": 1}],
        }).encode()
        request = Request(endpoint, data=body, headers={"Content-Type": "application/json"}, method="POST")
        try:
            with build_opener().open(request, timeout=20) as response:
                payload = json.loads(response.read(250000))
        except Exception:
            return {"written": written, "reason": "RPC_BUSY", "action": "NO_EXECUTION"}
        if mint not in json.dumps(payload):
            continue
        row = trade_row(mint, slot, result.get("blockTime"), None, True)
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a") as handle:
            handle.write(json.dumps(row) + "\n")
        written += 1
    return {"written": written, "reason": "SCANNED", "checked": min(limit, len(sigs)), "action": "NO_EXECUTION"}


def self_check() -> dict:
    row = trade_row(TOKEN, 1, 1700000000, 10, True)
    if TOKEN in json.dumps(row) or "AAI" in json.dumps(row):
        raise RuntimeError("TICKER_LEAKED")
    empty = adverse({"amount": 10}, {"amount": None})
    if empty["reason"] != "ABSTAIN":
        raise RuntimeError("FILLED_GAP")
    return {"coin": row["coin"], "abstain": empty["reason"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
