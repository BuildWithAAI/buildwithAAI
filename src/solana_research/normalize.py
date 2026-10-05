from __future__ import annotations

from typing import Any
from .model import RawEnvelope


class NormalizationError(ValueError):
    pass


class UnsupportedTransactionVersion(NormalizationError):
    pass


def normalize_block(envelope: RawEnvelope, *, slot: int, commitment: str,
                    max_supported_transaction_version: int = 1,
                    normalizer_version: str = "bt003-v1") -> dict[str, Any]:
    if envelope.method != "getBlock":
        raise NormalizationError("expected getBlock envelope")
    if "error" in envelope.payload:
        raise NormalizationError("RPC error present")
    block = envelope.payload.get("result")
    if block is None:
        raise NormalizationError("block unavailable")

    transactions = []
    versions: dict[str, int] = {}
    for index, item in enumerate(block.get("transactions") or []):
        version = item.get("version", "legacy")
        if version is None:
            version = "legacy"
        if isinstance(version, int) and version > max_supported_transaction_version:
            raise UnsupportedTransactionVersion(
                f"transaction version {version} exceeds supported version {max_supported_transaction_version}"
            )
        versions[str(version)] = versions.get(str(version), 0) + 1
        tx = item.get("transaction") or {}
        message = tx.get("message") or {}
        meta = item.get("meta") or {}
        signatures = tx.get("signatures") or []
        transactions.append({
            "signature": signatures[0] if signatures else None,
            "slot": slot,
            "block_time": block.get("blockTime"),
            "commitment": commitment.upper(),
            "transaction_index": index,
            "transaction_version": version,
            "success": meta.get("err") is None,
            "error": meta.get("err"),
            "fee_lamports": meta.get("fee"),
            "compute_units_consumed": meta.get("computeUnitsConsumed"),
            "account_keys": message.get("accountKeys"),
            "loaded_addresses": meta.get("loadedAddresses"),
            "pre_balances": meta.get("preBalances"),
            "post_balances": meta.get("postBalances"),
            "pre_token_balances": meta.get("preTokenBalances"),
            "post_token_balances": meta.get("postTokenBalances"),
            "instructions": message.get("instructions"),
            "inner_instructions": meta.get("innerInstructions"),
            "log_messages": meta.get("logMessages"),
            "source_id": envelope.source_id,
            "observed_time": envelope.received_at,
            "available_time": envelope.received_at,
            "raw_event_id": envelope.raw_event_id,
            "normalizer_version": normalizer_version,
            "quality_flags": [],
        })
    return {
        "cluster": "mainnet-beta", "slot": slot,
        "block_height": block.get("blockHeight"), "block_time": block.get("blockTime"),
        "blockhash": block.get("blockhash"), "previous_blockhash": block.get("previousBlockhash"),
        "parent_slot": block.get("parentSlot"), "commitment": commitment.upper(),
        "source_id": envelope.source_id, "observed_time": envelope.received_at,
        "available_time": envelope.received_at, "transaction_count": len(transactions),
        "rewards_present": block.get("rewards") is not None,
        "transaction_version_summary": versions, "raw_event_id": envelope.raw_event_id,
        "normalizer_version": normalizer_version, "quality_flags": [],
        "transactions": transactions,
    }
