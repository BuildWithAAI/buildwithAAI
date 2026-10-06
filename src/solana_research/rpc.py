from __future__ import annotations

import json
from typing import Any
from urllib.request import Request, urlopen
from .model import RawEnvelope

DEFAULT_PUBLIC_RPC = "https://api.mainnet-beta.solana.com"


def rpc_call(endpoint: str, method: str, params: list[Any], *, timeout: float = 15.0) -> dict[str, Any]:
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    request = Request(endpoint, data=body,
                      headers={"Content-Type": "application/json",
                               "User-Agent": "BuildWithAAI-BT003/1"},
                      method="POST")
    with urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def acquire_block(*, slot: int, endpoint: str = DEFAULT_PUBLIC_RPC,
                  commitment: str = "finalized",
                  max_supported_transaction_version: int = 1,
                  source_id: str = "solana-public-mainnet",
                  ingestion_build: str = "bt003-v1") -> RawEnvelope:
    params = [slot, {"commitment": commitment, "transactionDetails": "full",
                     "rewards": False,
                     "maxSupportedTransactionVersion": max_supported_transaction_version}]
    payload = rpc_call(endpoint, "getBlock", params)
    return RawEnvelope.from_rpc(source_id=source_id, method="getBlock", params=params,
                                requested_commitment=commitment, payload=payload,
                                parser_target_version=max_supported_transaction_version,
                                ingestion_build=ingestion_build)


def get_blocks(endpoint: str, start_slot: int, end_slot: int,
               *, commitment: str = "finalized", timeout: float = 15.0) -> list[int]:
    payload = rpc_call(endpoint, "getBlocks",
                       [start_slot, end_slot, {"commitment": commitment}], timeout=timeout)
    if "error" in payload:
        raise RuntimeError("getBlocks RPC error")
    return payload.get("result") or []
