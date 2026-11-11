"""Capture top-holder concentration for the mints in one collector snapshot.

The public Solana RPC is tried first. getTokenLargestAccounts is paced, and a
429 waits for Retry-After once before the next host is tried. When that method
stays rate-limited, each mint is read from the public Rugcheck token report.
A failed mint is stored as NOT_OBSERVED with its own read_ts_ms and source.
No share is invented. Nothing here sends an order.
"""
from __future__ import annotations

import hashlib
import json
import time
import urllib.error
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from .holder_concentration import (
    ALLOWED,
    interpret_rugcheck,
    live_read,
    not_observed,
    rugcheck_url,
    rugcheck_url_ok,
)
from .pump_public import SOURCE_BONDING, SOURCE_GRADUATION
from .snapshot_feed import canonical_pairs, load_latest, load_snapshot, resolve_root, snapshot_files

RPC_ORDER = (
    "https://api.mainnet-beta.solana.com",
    "https://api.mainnet.solana.com",
)
_MAX_ATTEMPTS = 3
_MAX_BACKOFF_S = 120
_DEFAULT_BACKOFF_S = 10
_BODY_LIMIT = 4_000_000
FRESH_MS = 6 * 60 * 60 * 1000
RETRY_MS = 30 * 60 * 1000
PENDING_LIMIT = 8
SNAPSHOT_WINDOW = 6
_PUMP_SOURCES = frozenset({SOURCE_BONDING, SOURCE_GRADUATION, "pumpfun_currently_live"})
_DUE_RANK = {"NEW_MINT": 0, "RETRY_NOT_OBSERVED": 1, "STALE_AVAILABLE": 2}


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("REFUSED")


def _iso(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _clock(now_ms):
    if now_ms is None:
        return lambda: int(time.time() * 1000)
    if type(now_ms) is int and not isinstance(now_ms, bool):
        state = {"value": now_ms}

        def tick():
            current = state["value"]
            state["value"] = current + 1
            return current

        return tick
    if not callable(now_ms):
        raise ValueError("INVALID_TIME")
    return now_ms


def _header_delay(headers) -> int:
    if not headers:
        return _DEFAULT_BACKOFF_S
    raw = headers.get("Retry-After") if hasattr(headers, "get") else None
    if type(raw) is str and raw.strip().isdigit():
        delay = int(raw.strip())
        if 0 <= delay <= _MAX_BACKOFF_S:
            return delay
    return _DEFAULT_BACKOFF_S


def _http_get(url: str) -> tuple[int, dict, bytes]:
    parts = urlsplit(url)
    path = parts.path
    prefix = "/v1/tokens/"
    suffix = "/report"
    mint = path[len(prefix):-len(suffix)] if path.startswith(prefix) and path.endswith(suffix) else ""
    if not rugcheck_url_ok(url, mint):
        raise ValueError("REFUSED")
    request = Request(url, headers={"Accept": "application/json", "User-Agent": "BuildWithAAI-giant-brain/1"}, method="GET")
    try:
        with build_opener(_NoRedirect()).open(request, timeout=20) as response:
            raw = response.read(_BODY_LIMIT + 1)
            status = getattr(response, "status", 200)
            headers = {key: value for key, value in response.headers.items()}
    except urllib.error.HTTPError as error:
        raw = error.read(_BODY_LIMIT + 1)
        headers = {key: value for key, value in error.headers.items()} if error.headers is not None else {}
        error.close()
        if len(raw) > _BODY_LIMIT:
            raise ValueError("RESPONSE_TOO_LARGE")
        return error.code, headers, raw
    if len(raw) > _BODY_LIMIT:
        raise ValueError("RESPONSE_TOO_LARGE")
    return status, headers, raw


def snapshot_mints(root: Path, relative: str | None = None) -> tuple[str, list[dict]]:
    """Canonical DexScreener mints in one snapshot, highest volume first."""
    root = resolve_root(root)
    if relative is None:
        relative = load_latest(root)["snapshot_file"]
    pairs = canonical_pairs(load_snapshot(root, relative))
    rows = []
    for mint, row in pairs.items():
        volume = row.get("volume_h1")
        pair = row.get("pair_address")
        rows.append({
            "mint": mint,
            "pair_address": pair if type(pair) is str else None,
            "symbol": row.get("symbol") if type(row.get("symbol")) is str else None,
            "volume_h1": volume if type(volume) in (int, float) and not isinstance(volume, bool) else None,
        })
    rows.sort(key=lambda item: (-(item["volume_h1"] if item["volume_h1"] is not None else -1), item["mint"]))
    return relative, rows


def _volume(value):
    if isinstance(value, bool) or type(value) not in (int, float):
        return None
    return value


def mints_from_records(records: list[dict]) -> list[dict]:
    """Canonical DexScreener mints, then pump launch or graduation mints not already listed."""
    rows = []
    seen = set()
    for mint, row in canonical_pairs(records).items():
        volume = _volume(row.get("volume_h1"))
        pair = row.get("pair_address")
        rows.append({
            "mint": mint,
            "pair_address": pair if type(pair) is str else None,
            "symbol": row.get("symbol") if type(row.get("symbol")) is str else None,
            "volume_h1": volume,
        })
        seen.add(mint)
    for row in records:
        if type(row) is not dict or row.get("source") not in _PUMP_SOURCES:
            continue
        mint = row.get("token_address")
        if type(mint) is not str or not mint or mint in seen:
            continue
        pair = row.get("pair_address")
        rows.append({
            "mint": mint,
            "pair_address": pair if type(pair) is str else None,
            "symbol": row.get("symbol") if type(row.get("symbol")) is str else None,
            "volume_h1": _volume(row.get("volume_h1")),
        })
        seen.add(mint)
    rows.sort(key=lambda item: (-(item["volume_h1"] if item["volume_h1"] is not None else -1), item["mint"]))
    return rows


def read_is_due(rows, now_ms: int, *, fresh_ms: int, retry_ms: int):
    """Why a mint needs a read, or None when the cached read is still fresh."""
    if type(now_ms) is not int or isinstance(now_ms, bool):
        return "NEW_MINT"
    if type(rows) is not list or not rows:
        return "NEW_MINT"
    latest = rows[-1]
    if type(latest) is not dict:
        return "NEW_MINT"
    stamp = latest.get("read_ts_ms")
    if type(stamp) is not int or isinstance(stamp, bool):
        return "NEW_MINT"
    if stamp > now_ms:
        return None
    age = now_ms - stamp
    status = latest.get("status")
    if status == "AVAILABLE":
        return "STALE_AVAILABLE" if age >= fresh_ms else None
    if status == "NOT_OBSERVED":
        return "RETRY_NOT_OBSERVED" if age >= retry_ms else None
    return "NEW_MINT"


def _check_millis(value, name: str, cap: int) -> int:
    if type(value) is not int or isinstance(value, bool) or value < 0 or value > cap:
        raise ValueError(name)
    return value


def pending_mints(
    root: Path,
    *,
    now_ms: int,
    fresh_ms: int = FRESH_MS,
    retry_ms: int = RETRY_MS,
    limit: int | None = PENDING_LIMIT,
    window: int = SNAPSHOT_WINDOW,
    reads=None,
) -> tuple[list[dict], dict]:
    """Mints in the newest snapshots whose cached holder read is missing or stale.

    Never-read mints come first, then a ``NOT_OBSERVED`` row past ``retry_ms``,
    then an ``AVAILABLE`` row past ``fresh_ms``. ``limit`` caps the list.
    """
    fresh_ms = _check_millis(fresh_ms, "INVALID_FRESH_MS", 7 * 24 * 60 * 60 * 1000)
    retry_ms = _check_millis(retry_ms, "INVALID_RETRY_MS", 7 * 24 * 60 * 60 * 1000)
    if type(window) is not int or isinstance(window, bool) or not 1 <= window <= 500:
        raise ValueError("INVALID_WINDOW")
    if limit is not None and (type(limit) is not int or isinstance(limit, bool) or limit < 1):
        raise ValueError("INVALID_LIMIT")
    if type(now_ms) is not int or isinstance(now_ms, bool):
        raise ValueError("INVALID_TIME")
    root = resolve_root(root)
    files = snapshot_files(root)
    if window < len(files):
        files = files[-window:]
    grouped = load_holder_reads(root) if reads is None else reads
    seen = set()
    due = []
    considered = 0
    cached = 0
    for relative in reversed(files):
        for item in mints_from_records(load_snapshot(root, relative)):
            if item["mint"] in seen:
                continue
            seen.add(item["mint"])
            considered += 1
            reason = read_is_due(grouped.get(item["mint"], []), now_ms, fresh_ms=fresh_ms, retry_ms=retry_ms)
            if reason is None:
                cached += 1
                continue
            chosen = dict(item)
            chosen["due"] = reason
            chosen["snapshot_file"] = relative
            due.append(chosen)
    due.sort(key=lambda item: (_DUE_RANK.get(item["due"], 9), -(item["volume_h1"] if item["volume_h1"] is not None else -1), item["mint"]))
    selected = due if limit is None else due[:limit]
    counts = {"NEW_MINT": 0, "RETRY_NOT_OBSERVED": 0, "STALE_AVAILABLE": 0}
    for item in selected:
        counts[item["due"]] = counts.get(item["due"], 0) + 1
    return selected, {
        "considered": considered,
        "cached": cached,
        "due": len(due),
        "selected": len(selected),
        "reasons": counts,
        "window_files": len(files),
    }


def _log_path(root: Path, read_ts_ms: int) -> Path:
    day = datetime.fromtimestamp(read_ts_ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d")
    folder = root / "holder-reads"
    folder.mkdir(parents=True, exist_ok=True)
    return folder / f"{day}.jsonl"


def append_read(root: Path, record: dict) -> None:
    stamp = record.get("read_ts_ms")
    if type(stamp) is not int or isinstance(stamp, bool) or stamp < 0:
        raise ValueError("MISSING_READ_TS")
    if type(record.get("mint")) is not str or type(record.get("source")) is not str:
        raise ValueError("HOLDER_LOG_SCHEMA")
    line = json.dumps(record, sort_keys=True, separators=(",", ":"))
    with _log_path(root, stamp).open("a", encoding="utf-8") as handle:
        handle.write(line + "\n")


def load_holder_reads(root: Path) -> dict[str, list[dict]]:
    """JSONL reads beside the snapshots, grouped by mint and ordered by read_ts_ms."""
    folder = Path(root) / "holder-reads"
    if not folder.is_dir():
        return {}
    grouped: dict[str, list[dict]] = {}
    for path in sorted(item for item in folder.glob("*.jsonl") if item.is_file()):
        with path.open(encoding="utf-8") as handle:
            for line_number, line in enumerate(handle, start=1):
                if not line.strip():
                    continue
                try:
                    row = json.loads(line)
                except json.JSONDecodeError as error:
                    raise ValueError(f"HOLDER_LOG_SCHEMA:{path.name}:{line_number}") from error
                if type(row) is not dict or type(row.get("mint")) is not str:
                    raise ValueError(f"HOLDER_LOG_SCHEMA:{path.name}:{line_number}")
                grouped.setdefault(row["mint"], []).append(row)
    for rows in grouped.values():
        rows.sort(key=lambda item: item["read_ts_ms"] if type(item.get("read_ts_ms")) is int and not isinstance(item.get("read_ts_ms"), bool) else -1)
    return grouped


def join_holder_read(rows, now_ms: int):
    """Latest read whose read_ts_ms is at or before the decision.

    An AVAILABLE read is preferred over an older NOT_OBSERVED row. A read
    taken after the decision is not returned.
    """
    if type(rows) is not list or type(now_ms) is not int or isinstance(now_ms, bool):
        return None
    available = []
    missed = []
    for row in rows:
        if type(row) is not dict:
            continue
        stamp = row.get("read_ts_ms")
        if type(stamp) is not int or isinstance(stamp, bool) or stamp > now_ms:
            continue
        if row.get("status") == "AVAILABLE":
            available.append(row)
        elif row.get("status") == "NOT_OBSERVED":
            missed.append(row)
    if available:
        return available[-1]
    if missed:
        return missed[-1]
    return None


def _probe_view(read: dict) -> dict:
    view = {
        "source": read.get("source") or read.get("endpoint"),
        "status": "AVAILABLE" if read.get("status") == "AVAILABLE" else "NOT_OBSERVED",
        "reason": read.get("reason"),
        "read_ts_ms": read.get("read_ts_ms") if type(read.get("read_ts_ms")) is int else read.get("fetched_at_ms"),
        "method": read.get("failed_method") if type(read.get("failed_method")) is str else "getTokenLargestAccounts",
    }
    for key in ("http_status", "retry_after_seconds", "rpc_error_code", "supply_slot", "rpc_retries"):
        value = read.get(key)
        if type(value) is int and not isinstance(value, bool):
            view[key] = value
    return view


def _probe_endpoint(mint: str, endpoint: str, *, pair_address, transport, sleep, clock) -> dict:
    if endpoint not in ALLOWED:
        raise ValueError("REFUSED")
    stamp = clock()
    first = live_read(mint, endpoint, pair_address=pair_address, transport=transport, fetched_at_ms=stamp)
    first["read_ts_ms"] = stamp
    first["source"] = endpoint
    if first.get("status") == "AVAILABLE" or (first.get("reason") != "RATE_LIMITED" and first.get("http_status") != 429):
        return first
    delay = first.get("retry_after_seconds")
    if type(delay) is not int or isinstance(delay, bool) or not 0 <= delay <= _MAX_BACKOFF_S:
        delay = _DEFAULT_BACKOFF_S
    sleep(delay)
    retried = clock()
    second = live_read(mint, endpoint, pair_address=pair_address, transport=transport, fetched_at_ms=retried)
    second["read_ts_ms"] = retried
    second["source"] = endpoint
    second["rpc_retries"] = 1
    return second


def _read_rugcheck(mint: str, *, pair_address, transport, sleep, clock) -> dict:
    url = rugcheck_url(mint)
    if url is None:
        return not_observed(mint, None, clock(), "BAD_MINT")
    getter = _http_get if transport is None else transport
    delay = 0
    status = None
    headers = {}
    raw = b""
    for attempt in range(_MAX_ATTEMPTS):
        if delay:
            sleep(delay)
        try:
            status, headers, raw = getter(url)
        except ValueError as error:
            reason = str(error) if str(error) in {"REFUSED", "RESPONSE_TOO_LARGE"} else "RESPONSE_SHAPE"
            return not_observed(mint, url, clock(), reason)
        except urllib.error.URLError as error:
            reason = "HTTP_TIMEOUT" if isinstance(error.reason, TimeoutError) else "HTTP_UNREACHABLE"
            return not_observed(mint, url, clock(), reason)
        except TimeoutError:
            return not_observed(mint, url, clock(), "HTTP_TIMEOUT")
        if status != 429:
            break
        delay = _header_delay(headers)
        if attempt == _MAX_ATTEMPTS - 1:
            return not_observed(
                mint, url, clock(), "RATE_LIMITED",
                http_status=429, retry_after_seconds=delay,
            )
    if status != 200 or type(raw) is not bytes:
        return not_observed(mint, url, clock(), "HTTP_STATUS", http_status=status if type(status) is int else None)
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return not_observed(mint, url, clock(), "RESPONSE_SHAPE", http_status=status)
    return interpret_rugcheck(
        mint, payload, source=url, read_ts_ms=clock(), pair_address=pair_address,
        body_sha256=hashlib.sha256(raw).hexdigest(),
    )


def _stamp_rpc(read: dict, *, snapshot_file: str, symbol, probe) -> dict:
    body = dict(read)
    stamp = body.get("read_ts_ms") if type(body.get("read_ts_ms")) is int else body.get("fetched_at_ms")
    body["read_ts_ms"] = stamp
    body["source"] = body.get("source") or body.get("endpoint")
    if type(stamp) is int:
        body["read_ts"] = _iso(stamp)
    body["execution_allowed"] = False
    body["live_orders"] = False
    if body.get("status") != "AVAILABLE":
        body["status"] = "NOT_OBSERVED"
        for key in (
            "top1_share_ppm", "top10_share_ppm", "top1_ex_vault_share_ppm", "top10_ex_vault_share_ppm",
            "supply_atoms", "top1_atoms", "top10_atoms",
        ):
            body[key] = None
    body["snapshot_file"] = snapshot_file
    if type(symbol) is str:
        body["symbol"] = symbol
    if probe is not None:
        body["rpc_probe"] = probe
    return body


def capture_holders(
    root: Path,
    *,
    snapshot: str | None = None,
    limit: int | None = None,
    interval_s: float = 1.0,
    sleep=time.sleep,
    now_ms=None,
    rpc_transport=None,
    http_transport=None,
    probe: bool = True,
    pending_only: bool = False,
    fresh_ms: int = FRESH_MS,
    retry_ms: int = RETRY_MS,
    window: int = SNAPSHOT_WINDOW,
) -> dict:
    """Read holder concentration for mints in one snapshot and append JSONL beside it.

    ``pending_only`` reads mints in the newest ``window`` snapshots that have
    no fresh cached read. An ``AVAILABLE`` read younger than ``fresh_ms`` is
    kept. A ``NOT_OBSERVED`` read is retried after ``retry_ms``. The default
    pending cap is 8 mints.
    """
    if type(interval_s) not in (int, float) or isinstance(interval_s, bool) or interval_s < 0 or interval_s > 30:
        raise ValueError("INVALID_INTERVAL")
    if limit is not None and (type(limit) is not int or isinstance(limit, bool) or limit < 1):
        raise ValueError("INVALID_LIMIT")
    if type(pending_only) is not bool:
        raise ValueError("INVALID_PENDING")
    root = resolve_root(root)
    clock = _clock(now_ms)
    started = clock()
    pending_stats = None
    if pending_only:
        if limit is None:
            limit = PENDING_LIMIT
        mints, pending_stats = pending_mints(
            root, now_ms=started, fresh_ms=fresh_ms, retry_ms=retry_ms, limit=limit, window=window,
        )
        relative = mints[0]["snapshot_file"] if mints else None
    else:
        relative, mints = snapshot_mints(root, snapshot)
        if limit is not None:
            mints = mints[:limit]
    probes = []
    rpc_endpoint = None
    probed_mint = None
    probe_hit = None
    if probe and mints:
        probed_mint = mints[0]["mint"]
        pair = mints[0]["pair_address"]
        for endpoint in RPC_ORDER:
            result = _probe_endpoint(
                probed_mint, endpoint, pair_address=pair, transport=rpc_transport, sleep=sleep, clock=clock,
            )
            probes.append(_probe_view(result))
            if result.get("status") == "AVAILABLE":
                rpc_endpoint = endpoint
                probe_hit = result
                break
            if interval_s:
                sleep(interval_s)
    stored = []
    succeeded = 0
    not_observed_count = 0
    use_rpc = rpc_endpoint is not None
    for index, item in enumerate(mints):
        reused = use_rpc and probe_hit is not None and index == 0 and item["mint"] == probed_mint
        if not reused and index and interval_s:
            sleep(interval_s)
        symbol = item["symbol"]
        pair = item["pair_address"]
        snap = item.get("snapshot_file") if type(item.get("snapshot_file")) is str else relative
        record = probe_hit if reused else None
        if use_rpc and not reused:
            stamp = clock()
            record = live_read(item["mint"], rpc_endpoint, pair_address=pair, transport=rpc_transport, fetched_at_ms=stamp)
            record["read_ts_ms"] = stamp
            record["source"] = rpc_endpoint
            if record.get("status") != "AVAILABLE" and (record.get("reason") == "RATE_LIMITED" or record.get("http_status") == 429):
                delay = record.get("retry_after_seconds")
                if type(delay) is not int or isinstance(delay, bool) or not 0 <= delay <= _MAX_BACKOFF_S:
                    delay = _DEFAULT_BACKOFF_S
                sleep(delay)
                stamp = clock()
                retried = live_read(item["mint"], rpc_endpoint, pair_address=pair, transport=rpc_transport, fetched_at_ms=stamp)
                retried["read_ts_ms"] = stamp
                retried["source"] = rpc_endpoint
                retried["rpc_retries"] = 1
                record = retried
                if record.get("status") != "AVAILABLE":
                    use_rpc = False
        if not use_rpc:
            record = _read_rugcheck(item["mint"], pair_address=pair, transport=http_transport, sleep=sleep, clock=clock)
        probe_note = probes[-1] if rpc_endpoint is None and probes else None
        stored_row = _stamp_rpc(record, snapshot_file=snap, symbol=symbol, probe=probe_note)
        append_read(root, stored_row)
        stored.append(stored_row["mint"])
        if stored_row.get("status") == "AVAILABLE":
            succeeded += 1
        else:
            not_observed_count += 1
    summary = {
        "protocol": "AAI_HOLDER_CAPTURE_V1",
        "snapshot_file": relative,
        "mints": len(mints),
        "stored": len(stored),
        "succeeded": succeeded,
        "not_observed": not_observed_count,
        "rpc_endpoint": rpc_endpoint,
        "rpc_probes": probes,
        "probed_mint": probed_mint,
        "started_ms": started,
        "started_at": _iso(started) if type(started) is int else None,
        "source_used": rpc_endpoint or ("https://api.rugcheck.xyz" if mints else None),
        "pending_only": pending_only,
        "action": "NO_EXECUTION",
        "execution_allowed": False,
        "live_orders": False,
    }
    if pending_stats is not None:
        summary["cached"] = pending_stats["cached"]
        summary["considered"] = pending_stats["considered"]
        summary["due"] = pending_stats["due"]
        summary["reasons"] = pending_stats["reasons"]
        summary["fresh_ms"] = fresh_ms
        summary["retry_ms"] = retry_ms
        summary["window"] = window
    return summary
