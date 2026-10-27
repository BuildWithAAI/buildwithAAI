from __future__ import annotations

import json
from typing import Any
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
from .model import RawEnvelope

DEFAULT_PUBLIC_RPC = "https://api.mainnet-beta.solana.com"
MAX_RESPONSE_BYTES = 2 * 1024 * 1024
READ_ONLY_METHODS = frozenset({"getBlock", "getBlocks"})


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError("RPC redirects are not permitted")


def rpc_call(endpoint: str, method: str, params: list[Any], *, timeout: float = 15.0) -> dict[str, Any]:
    if method not in READ_ONLY_METHODS:
        raise ValueError("read-only RPC method required")
    origin = urlsplit(endpoint)
    if (origin.scheme != "https" or not origin.hostname or origin.username or origin.password
            or origin.fragment or origin.port not in (None, 443) or not 0 < timeout <= 30):
        raise ValueError("RPC requires HTTPS and a bounded timeout")
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}, allow_nan=False).encode()
    request = Request(endpoint, data=body,
                      headers={"Content-Type": "application/json",
                               "User-Agent": "BuildWithAAI-BT003/1"}, method="POST")
    try:
        with build_opener(NoRedirect()).open(request, timeout=timeout) as response:
            raw = response.read(MAX_RESPONSE_BYTES + 1)
        if len(raw) > MAX_RESPONSE_BYTES:
            raise RuntimeError("RPC response exceeds bounded acquisition size")
        def invalid_constant(value):
            raise ValueError("non-finite RPC JSON")
        result = json.loads(raw.decode("utf-8"), parse_constant=invalid_constant)
        if not isinstance(result, dict) or result.get("jsonrpc") != "2.0" or type(result.get("id")) is not int or result["id"] != 1:
            raise RuntimeError("invalid RPC response envelope")
        return result
    except (OSError, UnicodeError, ValueError) as error:
        raise RuntimeError("RPC acquisition failed: " + type(error).__name__) from None


def acquire_block(*, slot: int, endpoint: str = DEFAULT_PUBLIC_RPC,
                  commitment: str = "finalized", max_supported_transaction_version: int = 1,
                  source_id: str = "solana-public-mainnet", ingestion_build: str = "bt003-v1") -> RawEnvelope:
    params = [slot, {"commitment": commitment, "transactionDetails": "full", "rewards": False,
                     "maxSupportedTransactionVersion": max_supported_transaction_version}]
    payload = rpc_call(endpoint, "getBlock", params)
    return RawEnvelope.from_rpc(source_id=source_id, method="getBlock", params=params,
                                requested_commitment=commitment, payload=payload,
                                parser_target_version=max_supported_transaction_version,
                                ingestion_build=ingestion_build)


def get_blocks(endpoint: str, start_slot: int, end_slot: int,
               *, commitment: str = "finalized", timeout: float = 15.0) -> list[int]:
    if type(start_slot) is not int or type(end_slot) is not int or start_slot < 0 or not 0 <= end_slot - start_slot < 32:
        raise ValueError("getBlocks requires a bounded nonnegative slot window")
    payload = rpc_call(endpoint, "getBlocks", [start_slot, end_slot, {"commitment": commitment}], timeout=timeout)
    if "error" in payload:
        raise RuntimeError("getBlocks RPC error")
    result = payload.get("result")
    if not isinstance(result, list) or len(result) > 32 or any(type(slot) is not int or not start_slot <= slot <= end_slot for slot in result):
        raise RuntimeError("invalid getBlocks result")
    return result
