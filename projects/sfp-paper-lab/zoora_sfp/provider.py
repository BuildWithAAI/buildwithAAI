"""Bounded public Kraken SOL/USD hourly observations; no account or order endpoints."""

import base64
import binascii
import hashlib
import http.client
import ssl
import time
import urllib.error
import urllib.request

from .data import (
    HOUR,
    ResearchError,
    canonical,
    decode,
    digest,
    exact,
    integer,
    number,
    parse_dataset,
    require,
)
from .importer import import_csv
from .reports import code_fingerprint

HOST = "api.kraken.com"
TARGETS = {"PAIR": "/0/public/AssetPairs?pair=SOLUSD&assetVersion=1",
           "OHLC": "/0/public/OHLC?pair=SOLUSD&interval=60&assetVersion=1"}
LIMITS = {"PAIR": 256 * 1024, "OHLC": 512 * 1024}
CAPTURE_PROTOCOL = "ZOORA_KRAKEN_SOLUSD_H1_CAPTURE_V1"
MODES = {"PUBLIC_HTTPS_GET_LOCAL_RECEIPT_NOT_EXTERNAL_ATTESTATION", "LOCAL_FILE_IMPORT_NOT_WITNESSED"}
MARKET = {"base": "SOL", "quote": "USD", "venue": "KRAKEN_SPOT",
          "source_id": "KRAKEN_SPOT_SOLUSD_H1_V1"}


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def clock():
    return time.time_ns() // 1_000_000


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def request_public(kind):
    require(kind in TARGETS, "PUBLIC_ENDPOINT_NOT_ALLOWED")
    start, deadline = clock(), time.monotonic() + 15
    response = None
    try:
        opener = urllib.request.build_opener(NoRedirect(),
                    urllib.request.HTTPSHandler(context=ssl.create_default_context()))
        url = "https://" + HOST + TARGETS[kind]
        request = urllib.request.Request(url, method="GET", headers={"Accept": "application/json",
                        "Accept-Encoding": "identity", "User-Agent": "BuildWithAAI-Research/0.4"})
        response = opener.open(request, timeout=8)
        require(response.geturl() == url, "PUBLIC_REDIRECT_REJECTED")
        require(response.status == 200, "PUBLIC_HTTP_STATUS_" + str(response.status))
        content_type = response.getheader("Content-Type", "").split(";", 1)[0].strip().lower()
        require(content_type == "application/json", "PUBLIC_CONTENT_TYPE_REJECTED")
        require(response.getheader("Content-Encoding", "identity").lower() == "identity",
                "PUBLIC_COMPRESSED_RESPONSE_REJECTED")
        declared = response.getheader("Content-Length")
        if declared is not None:
            require(declared.isascii() and declared.isdigit() and len(declared) <= 10 and
                    int(declared) <= LIMITS[kind], "PUBLIC_BODY_SIZE_LIMIT")
        chunks, size = [], 0
        while True:
            remaining = deadline - time.monotonic()
            require(remaining > 0, "PUBLIC_REQUEST_DEADLINE")
            chunk = response.read1(min(65536, LIMITS[kind] + 1 - size))
            if not chunk:
                break
            chunks.append(chunk)
            size += len(chunk)
            require(size <= LIMITS[kind], "PUBLIC_BODY_SIZE_LIMIT")
        raw = b"".join(chunks)
        require(declared is None or len(raw) == int(declared), "PUBLIC_TRUNCATED_RESPONSE")
        received = clock()
        require(start <= received <= start + 60_000, "PUBLIC_CLOCK_OR_DURATION_INVALID")
        return raw, {"kind": kind, "url": "https://" + HOST + TARGETS[kind], "method": "GET",
                     "status": 200, "content_type": content_type, "started_ms": start,
                     "received_ms": received, "body_bytes": len(raw), "body_sha256": sha(raw)}
    except urllib.error.HTTPError as exc:
        exc.close()
        raise ResearchError("PUBLIC_HTTP_STATUS_" + str(exc.code)) from exc
    except (OSError, http.client.HTTPException) as exc:
        raise ResearchError("PUBLIC_HTTPS_REQUEST_FAILED") from exc
    finally:
        if response is not None:
            response.close()


def _envelope(raw, limit):
    value = decode(raw, limit)
    exact(value, {"error", "result"}, "INVALID_PROVIDER_ENVELOPE")
    require(value["error"] == [] and isinstance(value["result"], dict), "PROVIDER_REPORTED_ERROR")
    return value["result"]


def parse_pair(raw):
    result = _envelope(raw, LIMITS["PAIR"])
    exact(result, {"SOL/USD"}, "PROVIDER_MARKET_IDENTITY_MISMATCH")
    pair = result["SOL/USD"]
    require(isinstance(pair, dict) and all(pair.get(k) == v for k, v in
            {"base": "SOL", "quote": "USD", "altname": "SOLUSD", "wsname": "SOL/USD",
             "aclass_base": "currency", "aclass_quote": "currency"}.items()),
            "PROVIDER_MARKET_IDENTITY_MISMATCH")
    require(isinstance(pair.get("status"), str) and
            pair["status"] in {"online", "cancel_only", "post_only", "limit_only", "reduce_only"},
            "UNSUPPORTED_PROVIDER_MARKET_STATUS")
    return {"pair_key": "SOL/USD", "base": "SOL", "quote": "USD", "status": pair["status"],
            "asset_version": 1, "instrument": "SPOT_NOT_AAI_TOKEN_OR_DERIVATIVE"}


def ohlc_csv(raw, as_of_ms, delay_ms):
    result = _envelope(raw, LIMITS["OHLC"])
    exact(result, {"SOL/USD", "last"}, "PROVIDER_OHLC_MARKET_MISMATCH")
    integer(result["last"], 0, 253_402_300_799)
    rows = result["SOL/USD"]
    # Observed public responses can contain 720 completed rows plus the current row.
    # Bound that single-row compatibility case and expose it instead of claiming the docs agree.
    require(isinstance(rows, list) and 2 <= len(rows) <= 721, "PROVIDER_OHLC_ROW_LIMIT")
    previous, completed, late = None, [], 0
    for i, row in enumerate(rows):
        require(isinstance(row, list) and len(row) == 8, "INVALID_PROVIDER_OHLC_ROW")
        start = integer(row[0], 0, 253_402_300_795) * 1000
        require(start % HOUR == 0 and (previous is None or start >= previous + HOUR),
                "PROVIDER_OHLC_ORDER_OR_INTERVAL")
        previous = start
        o, h, low, c, vwap, volume = [number(x) for x in row[1:7]]
        integer(row[7], 0, 2**53 - 1)
        require(0 < low <= min(o, c) <= max(o, c) <= h and volume >= 0 and
                (low <= vwap <= h or (vwap == 0 and volume == 0 and row[7] == 0)),
                "INVALID_PROVIDER_OHLC_PRICES")
        require(start <= as_of_ms, "PROVIDER_FUTURE_OPEN")
        # Kraken documents its final row as uncommitted regardless of 'since'.
        if i == len(rows) - 1:
            continue
        if start + HOUR + delay_ms > as_of_ms:
            late += 1
            continue
        completed.append(",".join([str(row[0]), *row[1:5], row[6], str(row[7])]))
    require(completed, "NO_COMPLETED_PROVIDER_BARS")
    return ("\n".join(completed) + "\n").encode(), {"raw_rows": len(rows),
            "uncommitted_final_rows_excluded": 1, "other_not_yet_available_rows_excluded": late,
            "documented_recent_row_limit": 720,
            "provider_contract_warnings": ["OBSERVED_721_ROWS_VS_DOCUMENTED_720_LIMIT"] if len(rows) == 721 else [],
            "provider_last_cursor": result["last"], "pagination": "RECENT_WINDOW_NOT_FULL_HISTORY"}


def make_capture(pair_raw, ohlc_raw, *, classification, delay_ms=0, requests=None, captured_ms=None,
                 source_head=None):
    require(classification in {"SYNTHETIC", "SOURCE_ASSERTED_OBSERVATIONS"}, "INVALID_CLASSIFICATION")
    if requests is None:
        integer(captured_ms, 0, clock(), "INVALID_CAPTURE_TIME")
        requests = [{"kind": kind, "url": "https://" + HOST + TARGETS[kind], "method": "GET",
                     "status": 200, "content_type": "application/json", "started_ms": captured_ms,
                     "received_ms": captured_ms, "body_bytes": len(raw), "body_sha256": sha(raw)}
                    for kind, raw in [("PAIR", pair_raw), ("OHLC", ohlc_raw)]]
        mode = "LOCAL_FILE_IMPORT_NOT_WITNESSED"
    else:
        require(classification == "SOURCE_ASSERTED_OBSERVATIONS", "HTTPS_CAPTURE_REQUIRES_OBSERVATION_LABEL")
        mode = "PUBLIC_HTTPS_GET_LOCAL_RECEIPT_NOT_EXTERNAL_ATTESTATION"
    value = {"protocol": CAPTURE_PROTOCOL, "classification": classification, "delay_ms": delay_ms,
             "mode": mode, "requests": requests,
             "pair_base64": base64.b64encode(pair_raw).decode("ascii"),
             "ohlc_base64": base64.b64encode(ohlc_raw).decode("ascii"),
             "producer_head_sha": source_head, "producer_code_fingerprint": code_fingerprint()}
    value["capture_sha256"] = digest(value)
    raw = canonical(value) + b"\n"
    parse_capture(raw)
    return raw


def capture_public(delay_ms=0, source_head=None):
    # No retry loop, credentials, arbitrary host, symbol or interval is accepted.
    integer(delay_ms, 0, 24 * HOUR)
    require(source_head is None or (isinstance(source_head, str) and len(source_head) == 40 and
            all(c in "0123456789abcdef" for c in source_head)), "INVALID_SOURCE_HEAD")
    pair, first = request_public("PAIR")
    parse_pair(pair)
    ohlc, second = request_public("OHLC")
    return make_capture(pair, ohlc, classification="SOURCE_ASSERTED_OBSERVATIONS", delay_ms=delay_ms,
                        requests=[first, second], source_head=source_head)


def parse_capture(raw):
    value = decode(raw, 2 * 1024 * 1024)
    exact(value, {"protocol", "classification", "delay_ms", "mode", "requests", "pair_base64",
                  "ohlc_base64", "producer_head_sha", "producer_code_fingerprint", "capture_sha256"})
    require(value["protocol"] == CAPTURE_PROTOCOL and isinstance(value["mode"], str) and
            value["mode"] in MODES, "INVALID_SOURCE_CAPTURE")
    require(value["capture_sha256"] == digest({k: v for k, v in value.items() if k != "capture_sha256"}),
            "SOURCE_CAPTURE_HASH_MISMATCH")
    require(isinstance(value["classification"], str) and
            value["classification"] in {"SYNTHETIC", "SOURCE_ASSERTED_OBSERVATIONS"} and
            (value["mode"] != "PUBLIC_HTTPS_GET_LOCAL_RECEIPT_NOT_EXTERNAL_ATTESTATION" or
             value["classification"] == "SOURCE_ASSERTED_OBSERVATIONS"), "INVALID_CLASSIFICATION")
    delay = integer(value["delay_ms"], 0, 24 * HOUR)
    head = value["producer_head_sha"]
    require(head is None or (isinstance(head, str) and len(head) == 40 and
            all(c in "0123456789abcdef" for c in head)), "INVALID_SOURCE_HEAD")
    fingerprint = value["producer_code_fingerprint"]
    require(isinstance(fingerprint, dict) and set(fingerprint) == {"files", "sha256", "scope"} and
            fingerprint["scope"] == "LOCAL_PACKAGE_BYTES_NOT_EXTERNAL_ATTESTATION" and
            isinstance(fingerprint.get("files"), dict) and
            fingerprint.get("sha256") == digest(fingerprint["files"]), "PRODUCER_FINGERPRINT_MISMATCH")
    try:
        pair_raw = base64.b64decode(value["pair_base64"], validate=True)
        ohlc_raw = base64.b64decode(value["ohlc_base64"], validate=True)
    except (ValueError, TypeError, binascii.Error) as exc:
        raise ResearchError("INVALID_SOURCE_BASE64") from exc
    require(len(pair_raw) <= LIMITS["PAIR"] and len(ohlc_raw) <= LIMITS["OHLC"], "INPUT_SIZE_LIMIT")
    require(isinstance(value["requests"], list) and len(value["requests"]) == 2, "INVALID_REQUEST_RECEIPTS")
    previous = 0
    for receipt, kind, body in zip(value["requests"], ["PAIR", "OHLC"], [pair_raw, ohlc_raw], strict=True):
        exact(receipt, {"kind", "url", "method", "status", "content_type", "started_ms", "received_ms",
                        "body_bytes", "body_sha256"}, "INVALID_REQUEST_RECEIPT")
        start = integer(receipt["started_ms"], previous, 253_402_300_799_000)
        previous = integer(receipt["received_ms"], start, start + 60_000)
        require(receipt["kind"] == kind and receipt["url"] == "https://" + HOST + TARGETS[kind] and
                receipt["method"] == "GET" and type(receipt["status"]) is int and receipt["status"] == 200 and
                receipt["content_type"] == "application/json" and type(receipt["body_bytes"]) is int and
                receipt["body_bytes"] == len(body) and receipt["body_sha256"] == sha(body),
                "REQUEST_RECEIPT_MISMATCH")
    market = parse_pair(pair_raw)
    as_of = value["requests"][1]["started_ms"]
    csv_raw, counts = ohlc_csv(ohlc_raw, as_of, delay)
    body, _ = import_csv(csv_raw, **MARKET, captured_ms=as_of, delay_ms=delay,
                         classification=value["classification"])
    ds_value = decode(body)
    ds_value["source_sha256"] = value["capture_sha256"]
    body = canonical(ds_value) + b"\n"
    ds = parse_dataset(body)
    lag = as_of - ds.bars[-1].close_ms
    flags = []
    if ds.gaps:
        flags.append("MISSING_HOURLY_INTERVALS")
    if lag > 2 * HOUR + delay:
        flags.append("STALE_LATEST_COMPLETED_BAR")
    if market["status"] != "online":
        flags.append("MARKET_NOT_ONLINE_AT_CAPTURE")
    if len(ds.bars) < 444:
        flags.append("INSUFFICIENT_DEFAULT_FIRST_TRAINING_HISTORY")
    quality = {"protocol": "ZOORA_SFP_SOURCE_QUALITY_V1", "capture_sha256": value["capture_sha256"],
               "market": MARKET, "provider_market": market, "classification": ds.classification,
               "availability": ds.availability, "captured_ms": as_of,
               "bars": len(ds.bars), "first_open_ms": ds.bars[0].open_ms,
               "last_close_ms": ds.bars[-1].close_ms, "latest_closed_bar_lag_ms": lag,
               "coverage_gaps": list(ds.gaps), "flags": flags,
               "local_data_screen": "BLOCKED" if flags else "PASS_LOCAL_DATA_SCREEN_ONLY", **counts,
               "source_verification": "PROVIDER_REPORTED_NOT_INDEPENDENTLY_VERIFIED",
               "transport": value["mode"], "unseen_status": "RETROSPECTIVE_NOT_ATTESTED_UNSEEN",
               "execution_quotes": "UNAVAILABLE", "venue_costs": "UNVERIFIED_SCENARIO_ASSUMPTIONS",
               "default_three_fold_study": "RECENT_WINDOW_TOO_SHORT_NO_AUTOMATIC_WINDOW_REDUCTION",
               "funds_transferred": "0", "tokens_purchased": "0", "tokens_burned": "0"}
    return {"capture": value, "raw": raw, "pair_raw": pair_raw, "ohlc_raw": ohlc_raw,
            "csv_raw": csv_raw, "dataset_raw": body, "dataset": ds, "quality": quality}
