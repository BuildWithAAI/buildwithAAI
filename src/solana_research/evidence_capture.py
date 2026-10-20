"""Read-only, bounded public-RPC acquisition with exact source response retention."""
from __future__ import annotations

import base64
from datetime import datetime, timezone
from pathlib import Path
import time
from urllib.error import HTTPError
from urllib.request import Request, build_opener

from .coin_evidence import (
    ENDPOINTS, MAX_RAW, EvidenceError, archive_blocks, canonical, digest,
    integer, parse, require, sha, write,
)
from .rpc import NoRedirect


def fetch(request, endpoint, limit):
    message = Request(endpoint, data=canonical(request).encode(),
                      headers={"Content-Type": "application/json", "Accept": "application/json",
                               "User-Agent": "BuildWithAAI-AAIFun-Research/1"}, method="POST")
    try:
        with build_opener(NoRedirect()).open(message, timeout=15) as response:
            return response.status, response.read(limit + 1), None
    except HTTPError as error:
        return error.code, error.read(min(limit + 1, 65_536)), "HTTP_" + str(error.code)
    except (OSError, RuntimeError) as error:
        return None, b"", "TRANSPORT_" + type(error).__name__


def capture(output, *, endpoint=ENDPOINTS[0], start_slot=None, count=1, transport=None):
    require(endpoint in ENDPOINTS, "UNAPPROVED_PUBLIC_ENDPOINT")
    integer(count, 1, 4)
    if start_slot is not None:
        integer(start_slot)
    output = Path(output)
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    archive = {"protocol": "AAI_SOLANA_RAW_BLOCK_ARCHIVE_V1", "classification": "RPC_CAPTURE",
               "endpoint": endpoint, "status": "INCOMPLETE", "error": None,
               "requested_start_slot": start_slot, "requested_end_slot": None,
               "capture_code_sha256": sha(Path(__file__).read_bytes()), "records": []}
    total, started = 0, time.monotonic()
    transport = fetch if transport is None else transport

    def rpc(method, params):
        nonlocal total
        require(method in {"getGenesisHash", "getSlot", "getBlocks", "getBlock"}, "READ_ONLY_METHOD")
        require(len(archive["records"]) < 7 and time.monotonic() - started < 180, "CAPTURE_BUDGET")
        request = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
        before = time.monotonic()
        status, raw, error = transport(request, endpoint, MAX_RAW - total)
        require(type(raw) is bytes, "TRANSPORT_BYTES")
        elapsed = round((time.monotonic() - before) * 1000)
        if len(raw) > MAX_RAW - total:
            # Retain the bounded received prefix as incomplete evidence, never parse a truncated block.
            raw = raw[:MAX_RAW - total]
            error = "RESPONSE_EXCEEDS_CAPTURE_BUDGET"
        total += len(raw)
        archive["records"].append({
            "request": request, "request_sha256": digest(request),
            "received_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "elapsed_ms": elapsed, "http_status": status,
            "response_base64": base64.b64encode(raw).decode(), "response_sha256": sha(raw), "error": error})
        require(status == 200 and error is None, "RPC_TRANSPORT_FAILURE")
        payload = parse(raw)
        require(type(payload) is dict and payload.get("jsonrpc") == "2.0"
                and type(payload.get("id")) is int and payload["id"] == 1
                and "error" not in payload and "result" in payload, "RPC_RESPONSE_ERROR")
        return payload["result"]

    try:
        from .coin_evidence import MAINNET_GENESIS
        require(rpc("getGenesisHash", []) == MAINNET_GENESIS, "WRONG_GENESIS")
        finalized = integer(rpc("getSlot", [{"commitment": "finalized"}]))
        end = finalized if start_slot is None else start_slot + count - 1
        start = end - count + 1 if start_slot is None else start_slot
        require(0 <= start <= end <= finalized, "FINALIZED_WINDOW_REQUIRED")
        archive["requested_start_slot"], archive["requested_end_slot"] = start, end
        slots = rpc("getBlocks", [start, end, {"commitment": "finalized"}])
        require(type(slots) is list and len(slots) <= count
                and all(type(s) is int and start <= s <= end for s in slots)
                and slots == sorted(set(slots)), "INVALID_BLOCK_COVERAGE")
        for slot in slots:
            rpc("getBlock", [slot, {"commitment": "finalized", "encoding": "json",
                "transactionDetails": "full", "rewards": False, "maxSupportedTransactionVersion": 1}])
        archive["status"] = "COMPLETE"
        archive_blocks(archive)
    except (EvidenceError, OSError, RuntimeError, ValueError) as error:
        archive["status"], archive["error"] = "INCOMPLETE", type(error).__name__
        write(output / "archive.json", archive)
        raise EvidenceError("CAPTURE_INCOMPLETE_INSPECT_RETAINED_ARCHIVE") from error
    write(output / "archive.json", archive)
    return archive
