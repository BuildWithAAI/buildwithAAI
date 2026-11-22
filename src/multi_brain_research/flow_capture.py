"""Capture GeckoTerminal pool trades for candidate mints and gate paper entries.

Candidates are thesis mints already on disk and mints in the newest snapshots.
A cycle stores at most 8 reads. An AVAILABLE read younger than 15 minutes is
kept. A NOT_OBSERVED read is retried after 5 minutes. The JSONL sits beside
the snapshots as ``pool-trades/YYYY-MM-DD.jsonl`` and carries ``read_ts_ms``.

The entry veto is not a vote and does not change the fused score. It refuses
a new paper open when a causal holder read is RAISED, or when a causal trades
read has a large-sell share at or above 500000 ppm. A read taken after the
decision is ignored. A missing read is not a veto. Nothing here sends an order.
"""
from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from pathlib import Path

from .holder_capture import mints_from_records, read_is_due
from .holder_concentration import RULE_TOP10_SHARE_PPM, thesis_parts
from .pool_trades import LARGE_SELL_SHARE_PPM, fetch_trades, trades_url
from .snapshot_feed import SnapshotError, load_snapshot, resolve_root, snapshot_files

FRESH_MS = 15 * 60 * 1000
RETRY_MS = 5 * 60 * 1000
PENDING_LIMIT = 8
SNAPSHOT_WINDOW = 6
_DUE_RANK = {"NEW_MINT": 0, "RETRY_NOT_OBSERVED": 1, "STALE_AVAILABLE": 2}


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


def _log_path(root: Path, read_ts_ms: int) -> Path:
    day = datetime.fromtimestamp(read_ts_ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d")
    folder = root / "pool-trades"
    folder.mkdir(parents=True, exist_ok=True)
    return folder / f"{day}.jsonl"


def append_read(root: Path, record: dict) -> None:
    stamp = record.get("read_ts_ms")
    if type(stamp) is not int or isinstance(stamp, bool) or stamp < 0:
        raise ValueError("MISSING_READ_TS")
    if type(record.get("mint")) is not str or type(record.get("pool")) is not str or type(record.get("source")) is not str:
        raise ValueError("FLOW_LOG_SCHEMA")
    line = json.dumps(record, sort_keys=True, separators=(",", ":"))
    with _log_path(root, stamp).open("a", encoding="utf-8") as handle:
        handle.write(line + "\n")


def load_flow_reads(root: Path) -> dict[str, list[dict]]:
    """JSONL reads beside the snapshots, grouped by mint and ordered by read_ts_ms."""
    folder = Path(root) / "pool-trades"
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
                    raise ValueError(f"FLOW_LOG_SCHEMA:{path.name}:{line_number}") from error
                if type(row) is not dict or type(row.get("mint")) is not str:
                    raise ValueError(f"FLOW_LOG_SCHEMA:{path.name}:{line_number}")
                grouped.setdefault(row["mint"], []).append(row)
    for rows in grouped.values():
        rows.sort(key=lambda item: item["read_ts_ms"] if type(item.get("read_ts_ms")) is int and not isinstance(item.get("read_ts_ms"), bool) else -1)
    return grouped


def join_flow_read(rows, now_ms: int, pool: str | None):
    """Latest read for this pool whose read_ts_ms is at or before the decision.

    A read for a different pool is not used. An AVAILABLE read is preferred
    over an older NOT_OBSERVED row. A read taken after the decision is not
    returned.
    """
    if type(rows) is not list or type(now_ms) is not int or isinstance(now_ms, bool) or type(pool) is not str:
        return None
    available = []
    missed = []
    for row in rows:
        if type(row) is not dict or row.get("pool") != pool:
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


def _check_millis(value, name: str) -> int:
    if type(value) is not int or isinstance(value, bool) or value < 0 or value > 7 * 24 * 60 * 60 * 1000:
        raise ValueError(name)
    return value


def _thesis_candidates(root: Path) -> list[dict]:
    folder = root / "brain-runs" / "theses"
    if not folder.is_dir():
        return []
    files = [path for path in folder.glob("*.json") if path.is_file() and not path.name.endswith(".market.json")]
    files.sort(key=lambda path: path.stat().st_mtime, reverse=True)
    rows = []
    seen = set()
    for path in files:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if type(data) is not dict:
            continue
        mint = data.get("mint")
        provenance = data.get("provenance") if type(data.get("provenance")) is dict else {}
        pair = data.get("pair") if type(data.get("pair")) is dict else {}
        pool = provenance.get("pair_address") if type(provenance.get("pair_address")) is str else None
        if pool is None and type(pair.get("pair_address")) is str:
            pool = pair.get("pair_address")
        if type(mint) is not str or not mint or pool is None or mint in seen:
            continue
        try:
            trades_url(pool)
        except SnapshotError:
            continue
        seen.add(mint)
        rows.append({
            "mint": mint,
            "pair_address": pool,
            "symbol": data.get("symbol") if type(data.get("symbol")) is str else None,
            "volume_h1": None,
            "thesis": True,
            "thesis_id": data.get("thesis_id") if type(data.get("thesis_id")) is str else None,
        })
    return rows


def candidate_mints(
    root: Path,
    *,
    now_ms: int,
    fresh_ms: int = FRESH_MS,
    retry_ms: int = RETRY_MS,
    limit: int | None = PENDING_LIMIT,
    window: int = SNAPSHOT_WINDOW,
    reads=None,
    pending_only: bool = True,
) -> tuple[list[dict], dict]:
    """Thesis mints and mints in the newest snapshots, capped.

    A mint in the newest snapshot comes before an older thesis. Inside that
    group, a missing read comes before a retry, then a stale read, then
    higher hourly volume. ``pending_only`` drops a mint whose cached read is
    still fresh.
    """
    fresh_ms = _check_millis(fresh_ms, "INVALID_FRESH_MS")
    retry_ms = _check_millis(retry_ms, "INVALID_RETRY_MS")
    if type(window) is not int or isinstance(window, bool) or not 1 <= window <= 500:
        raise ValueError("INVALID_WINDOW")
    if limit is not None and (type(limit) is not int or isinstance(limit, bool) or limit < 1):
        raise ValueError("INVALID_LIMIT")
    if type(now_ms) is not int or isinstance(now_ms, bool):
        raise ValueError("INVALID_TIME")
    if type(pending_only) is not bool:
        raise ValueError("INVALID_PENDING")
    root = resolve_root(root)
    files = snapshot_files(root)
    if window < len(files):
        files = files[-window:]
    newest = files[-1] if files else None
    grouped = load_flow_reads(root) if reads is None else reads
    theses = {item["mint"]: item for item in _thesis_candidates(root)}
    seen = set()
    rows = []
    for relative in reversed(files):
        for item in mints_from_records(load_snapshot(root, relative)):
            if item["mint"] in seen:
                continue
            pool = item.get("pair_address")
            if type(pool) is not str:
                continue
            try:
                trades_url(pool)
            except SnapshotError:
                continue
            seen.add(item["mint"])
            chosen = dict(item)
            chosen["thesis"] = item["mint"] in theses
            chosen["snapshot_file"] = relative
            chosen["in_newest"] = relative == newest
            rows.append(chosen)
    for mint, item in theses.items():
        if mint in seen:
            continue
        chosen = dict(item)
        chosen["snapshot_file"] = newest
        chosen["in_newest"] = False
        rows.append(chosen)
    considered = len(rows)
    due = []
    cached = 0
    for item in rows:
        reason = read_is_due(grouped.get(item["mint"], []), now_ms, fresh_ms=fresh_ms, retry_ms=retry_ms)
        if reason is None:
            cached += 1
            if pending_only:
                continue
            reason = "FRESH"
        chosen = dict(item)
        chosen["due"] = reason
        due.append(chosen)
    due.sort(key=lambda item: (
        0 if item.get("in_newest") else 1,
        0 if item.get("thesis") else 1,
        _DUE_RANK.get(item.get("due"), 9),
        -(item["volume_h1"] if item.get("volume_h1") is not None else -1),
        item["mint"],
    ))
    selected = due if limit is None else due[:limit]
    return selected, {
        "considered": considered,
        "cached": cached,
        "due": len(due),
        "selected": len(selected),
        "window_files": len(files),
        "newest_file": newest,
    }


def _stamp(result: dict, item: dict, read_ts_ms: int) -> dict:
    body = {
        "protocol": "AAI_POOL_TRADES_V1",
        "status": "AVAILABLE" if result.get("status") == "AVAILABLE" else "NOT_OBSERVED",
        "reason": result.get("reason"),
        "mint": item["mint"],
        "pool": item["pair_address"],
        "symbol": item.get("symbol") if type(item.get("symbol")) is str else None,
        "source": result.get("url") or trades_url(item["pair_address"]),
        "read_ts_ms": read_ts_ms,
        "read_ts": _iso(read_ts_ms),
        "snapshot_file": item.get("snapshot_file"),
        "thesis": item.get("thesis") is True,
        "features": result.get("features") if result.get("status") == "AVAILABLE" else None,
        "trade_count": result.get("trade_count") if result.get("status") == "AVAILABLE" else None,
        "rows_skipped": result.get("rows_skipped") if result.get("status") == "AVAILABLE" else None,
        "body_sha256": result.get("body_sha256"),
        "retries": result.get("retries") if type(result.get("retries")) is int else 0,
        "action": "NO_EXECUTION",
        "execution_allowed": False,
        "live_orders": False,
    }
    for key in ("http_status", "retry_after_seconds"):
        value = result.get(key)
        if type(value) is int and not isinstance(value, bool):
            body[key] = value
    if body["status"] != "AVAILABLE":
        body["features"] = None
        body["trade_count"] = None
    return body


def capture_pool_trades(
    root: Path,
    *,
    limit: int | None = PENDING_LIMIT,
    interval_s: float = 1.0,
    sleep=time.sleep,
    now_ms=None,
    transport=None,
    pending_only: bool = True,
    fresh_ms: int = FRESH_MS,
    retry_ms: int = RETRY_MS,
    window: int = SNAPSHOT_WINDOW,
) -> dict:
    """Append pool-trade reads for candidate mints. Paper only."""
    if type(interval_s) not in (int, float) or isinstance(interval_s, bool) or interval_s < 0 or interval_s > 30:
        raise ValueError("INVALID_INTERVAL")
    if limit is not None and (type(limit) is not int or isinstance(limit, bool) or limit < 1):
        raise ValueError("INVALID_LIMIT")
    root = resolve_root(root)
    clock = _clock(now_ms)
    started = clock()
    selected, stats = candidate_mints(
        root, now_ms=started, fresh_ms=fresh_ms, retry_ms=retry_ms, limit=limit, window=window,
        pending_only=pending_only,
    )
    stored = []
    succeeded = 0
    not_observed_count = 0
    for index, item in enumerate(selected):
        if index and interval_s:
            sleep(interval_s)
        result = fetch_trades(item["pair_address"], transport=transport, sleep=sleep)
        record = _stamp(result, item, clock())
        append_read(root, record)
        stored.append(record["mint"])
        if record["status"] == "AVAILABLE":
            succeeded += 1
        else:
            not_observed_count += 1
    summary = {
        "protocol": "AAI_POOL_TRADE_CAPTURE_V1",
        "mints": len(selected),
        "stored": len(stored),
        "succeeded": succeeded,
        "not_observed": not_observed_count,
        "considered": stats["considered"],
        "cached": stats["cached"],
        "due": stats["due"],
        "window": window,
        "window_files": stats["window_files"],
        "newest_file": stats["newest_file"],
        "pending_only": pending_only,
        "fresh_ms": fresh_ms,
        "retry_ms": retry_ms,
        "limit": limit,
        "started_ms": started,
        "started_at": _iso(started) if type(started) is int else None,
        "action": "NO_EXECUTION",
        "execution_allowed": False,
        "live_orders": False,
    }
    return summary


def entry_veto_reasons(holder_read, flow_read, now_ms: int) -> tuple[list[str], dict]:
    """Skip reasons from causal reads. An empty list means neither gate fired.

    Holder concentration uses the existing 500000 ppm compared-share rule.
    Flow uses the large-sell share on the stored features. Either one is
    enough. A later read, a NOT_OBSERVED read, and a missing read add nothing.
    """
    reasons = []
    evidence = {}
    if type(now_ms) is not int or isinstance(now_ms, bool):
        return reasons, evidence
    flag, _summary = thesis_parts(holder_read, now_ms)
    if flag.get("status") == "RAISED":
        reasons.append("HOLDER_CONCENTRATION_RAISED")
        observed = flag.get("observed") if type(flag.get("observed")) is dict else {}
        evidence["holder_read_ts_ms"] = flag.get("read_ts_ms")
        evidence["compared_share_ppm"] = observed.get("compared_share_ppm")
        evidence["rule_top10_share_ppm"] = RULE_TOP10_SHARE_PPM
    if type(flow_read) is dict and flow_read.get("status") == "AVAILABLE":
        stamp = flow_read.get("read_ts_ms")
        features = flow_read.get("features")
        share = features.get("large_sell_share_ppm") if type(features) is dict else None
        if type(stamp) is int and not isinstance(stamp, bool) and stamp <= now_ms and type(share) is int and not isinstance(share, bool) and share >= LARGE_SELL_SHARE_PPM:
            reasons.append("FLOW_LARGE_SELL")
            evidence["flow_read_ts_ms"] = stamp
            evidence["pool"] = flow_read.get("pool")
            evidence["large_sell_share_ppm"] = share
            evidence["rule_large_sell_share_ppm"] = LARGE_SELL_SHARE_PPM
            evidence["largest_sell_usd"] = features.get("largest_sell_usd") if type(features) is dict else None
    return reasons, evidence
