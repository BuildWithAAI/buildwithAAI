"""Anonymized real tape for AAI.fun.

Tickers and mints are hidden. Slot, time, amounts, and success stay.
A row is real only if it came from the allowlisted read-only RPC.
Synthetic cannot enter this file. No send.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from .rpc import DEFAULT_PUBLIC_RPC, rpc_call

TOKEN = "27RP3fkHt6T2QpCzsrJjk9oMZXAP5cya77VaR3UMpump"


def alias(value: str) -> str:
    digest = hashlib.sha256(value.encode()).hexdigest()[:12]
    return "c_" + digest


def hide(record: dict) -> dict:
    mint = record.get("mint") or record.get("ticker") or "unknown"
    return {
        "label": "REAL_ANONYMIZED",
        "coin": alias(mint),
        "slot": record.get("slot"),
        "block_time": record.get("block_time"),
        "fee_lamports": record.get("fee_lamports"),
        "success": record.get("success"),
        "amount": record.get("amount"),
        "synthetic": False,
        "action": "NO_EXECUTION",
    }


def capture_block(endpoint: str = DEFAULT_PUBLIC_RPC) -> dict:
    if endpoint != DEFAULT_PUBLIC_RPC:
        return {"labeled": False, "reason": "RPC_REFUSED", "action": "NO_EXECUTION"}
    slot = rpc_call(endpoint, "getBlocks", [1, 1])
    # getBlocks needs a real window. Use getSlot via a block fetch from a known finalized slot
    # by asking getBlocks for a recent range is not available without getSlot.
    # Caller passes a slot. This function only accepts the allowlisted endpoint.
    return {"ok": True, "endpoint": endpoint, "action": "NO_EXECUTION", "note": slot.get("result")}


def from_slot(endpoint: str, slot: int, path: Path) -> dict:
    if endpoint != DEFAULT_PUBLIC_RPC:
        return {"labeled": False, "reason": "RPC_REFUSED", "action": "NO_EXECUTION"}
    payload = rpc_call(endpoint, "getBlock", [slot, {"encoding": "json", "transactionDetails": "signatures", "rewards": False, "maxSupportedTransactionVersion": 0}])
    block = payload.get("result") or {}
    hidden = hide({
        "mint": TOKEN,
        "slot": slot,
        "block_time": block.get("blockTime"),
        "fee_lamports": None,
        "success": block.get("blockhash") is not None,
        "amount": len(block.get("signatures") or []),
    })
    hidden["tx_count"] = hidden.pop("amount")
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a") as handle:
        handle.write(json.dumps(hidden) + "\n")
    return hidden


def self_check() -> dict:
    row = hide({"mint": TOKEN, "ticker": "AAI", "slot": 1, "block_time": 1700000000, "fee_lamports": 5000, "success": True, "amount": 10})
    if "AAI" in json.dumps(row) or TOKEN in json.dumps(row) or row["label"] != "REAL_ANONYMIZED":
        raise RuntimeError("TICKER_LEAKED")
    return {"coin": row["coin"], "time": row["block_time"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
