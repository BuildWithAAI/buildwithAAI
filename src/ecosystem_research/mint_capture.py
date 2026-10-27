"""Retain bounded current mint-account RPC bytes; never historical risk labels."""
from __future__ import annotations

import base64
from datetime import datetime, timezone
from pathlib import Path
import time

from ..solana_research import coin_evidence as ev
from ..solana_research import evidence_capture as capture
from ..multi_brain_research import training_lab as lab
from .handoff import assets

MAX_RESPONSE = 256 * 1024
MAX_TOTAL_RAW = 8 * 1024**2
MAX_STORED = 12 * 1024**2
FIELDS = ("protocol", "classification", "dataset_sha256", "endpoint", "mint",
          "min_context_slot", "capture_code_sha256", "record")


def _value(item, data, mint, minimum):
    lab.exact(item, FIELDS)
    lab.require(item["protocol"] == "AAI_ECOSYSTEM_MINT_RPC_RECORD_V1"
                and item["classification"] == "RPC_CAPTURE"
                and item["dataset_sha256"] == lab.digest(data)
                and item["endpoint"] in ev.ENDPOINTS and item["mint"] == mint
                and type(item["min_context_slot"]) is int and item["min_context_slot"] == minimum, "MINT_CAPTURE_BINDING")
    lab.pin(item["capture_code_sha256"])
    record = item["record"]
    lab.exact(record, ("request", "request_sha256", "received_at", "elapsed_ms", "http_status",
                       "response_base64", "response_sha256", "error"))
    method = "getGenesisHash" if mint is None else "getAccountInfo"
    params = [] if mint is None else [mint, {"encoding": "base64", "commitment": "finalized",
                                           "minContextSlot": minimum}]
    expected = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
    lab.require(lab.canonical(record["request"]) == lab.canonical(expected)
                and record["request_sha256"] == ev.digest(record["request"]),
                "MINT_CAPTURE_REQUEST")
    ev.timestamp(record["received_at"])
    ev.integer(record["elapsed_ms"], 0, 120_000)
    raw = ev.unbase64(record["response_base64"], MAX_RESPONSE)
    lab.require(record["response_sha256"] == ev.sha(raw)
                and record["http_status"] == 200 and record["error"] is None, "MINT_CAPTURE_INCOMPLETE")
    payload = ev.parse(raw)
    lab.require(type(payload) is dict and payload.get("jsonrpc") == "2.0"
                and type(payload.get("id")) is int and payload["id"] == 1
                and "error" not in payload and "result" in payload, "MINT_RPC_RESPONSE")
    if mint is None:
        lab.require(payload["result"] == ev.MAINNET_GENESIS, "WRONG_GENESIS")
    else:
        result = payload["result"]
        lab.require(type(result) is dict and type(result.get("context")) is dict
                    and "value" in result, "MINT_RPC_RESULT")
        lab.require(ev.integer(result["context"].get("slot")) >= minimum, "MINT_CONTEXT_TOO_OLD")
    return payload, len(raw)


def read(directory, data):
    root = Path(directory)
    wanted = assets(data)
    minimum = max(s["end_slot"] for s in data["sources"])
    lab.require(root.is_dir() and not root.is_symlink(), "MINT_CAPTURE_DIRECTORY")
    names = ["network.json", *(f"mint_{i:03}.json" for i in range(len(wanted)))]
    lab.require(set(p.name for p in root.iterdir()) == set(names), "MINT_CAPTURE_LAYOUT")
    lab.require(sum((root / n).stat().st_size for n in names) <= MAX_STORED, "MINT_CAPTURE_STORAGE")
    network = ev.read(root / "network.json")
    _, total = _value(network, data, None, minimum)
    result = []
    for index, (mint, decimals) in enumerate(wanted.items()):
        item = ev.read(root / f"mint_{index:03}.json")
        lab.require(item["endpoint"] == network["endpoint"], "MINT_ENDPOINT_CHANGED")
        payload, size = _value(item, data, mint, minimum)
        total += size
        lab.require(total <= MAX_TOTAL_RAW, "MINT_TOTAL_RAW_BOUND")
        result.append((mint, decimals, item, payload))
    return result


def collect(directory, data, *, endpoint=ev.ENDPOINTS[0], transport=None):
    lab.require(data["classification"] == "RPC_CAPTURE", "REAL_SOURCE_REQUIRED")
    lab.require(endpoint in ev.ENDPOINTS, "UNAPPROVED_PUBLIC_ENDPOINT")
    wanted = assets(data)
    minimum = max(s["end_slot"] for s in data["sources"])
    root = Path(directory)
    root.mkdir(mode=0o700, parents=True, exist_ok=False)
    source = capture.fetch if transport is None else transport
    total, previous, started = 0, None, time.monotonic()
    for index, mint in enumerate([None, *wanted]):
        lab.require(time.monotonic() - started < 600, "MINT_CAPTURE_TIME_BUDGET")
        if transport is None and previous is not None:
            time.sleep(max(0, 0.8 - (time.monotonic() - previous)))
        previous = time.monotonic()
        method = "getGenesisHash" if mint is None else "getAccountInfo"
        params = [] if mint is None else [mint, {"encoding": "base64", "commitment": "finalized",
                                               "minContextSlot": minimum}]
        request = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
        limit = min(MAX_RESPONSE, MAX_TOTAL_RAW - total)
        lab.require(limit > 0, "MINT_TOTAL_RAW_BOUND")
        before = time.monotonic()
        status, raw, error = source(request, endpoint, limit)
        lab.require(type(raw) is bytes, "TRANSPORT_BYTES")
        if len(raw) > limit:
            raw, error = raw[:limit], "MINT_RESPONSE_BOUND"
        total += len(raw)
        item = {"protocol": "AAI_ECOSYSTEM_MINT_RPC_RECORD_V1", "classification": "RPC_CAPTURE",
                "dataset_sha256": lab.digest(data), "endpoint": endpoint, "mint": mint,
                "min_context_slot": minimum, "capture_code_sha256": ev.sha(Path(__file__).read_bytes()),
                "record": {"request": request, "request_sha256": ev.digest(request),
                           "received_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                           "elapsed_ms": round((time.monotonic() - before) * 1000),
                           "http_status": status, "response_base64": base64.b64encode(raw).decode(),
                           "response_sha256": ev.sha(raw), "error": error}}
        name = "network.json" if mint is None else f"mint_{index - 1:03}.json"
        ev.write(root / name, item)
        _value(item, data, mint, minimum)  # Failed/truncated responses remain, then stop.
    return read(root, data)
