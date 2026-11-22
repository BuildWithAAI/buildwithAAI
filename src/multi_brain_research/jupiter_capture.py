"""Capture public Jupiter token fields for mints in recent snapshots.

Candidates are thesis mints already on disk and mints in the newest snapshots.
One cycle stores at most 40 mints, which is one search request. An AVAILABLE
read younger than 15 minutes is kept. A NOT_OBSERVED read is retried after 5
minutes. The JSONL sits beside the snapshots as ``jupiter-tokens/YYYY-MM-DD.jsonl``
and carries ``read_ts_ms``.

The readout suffix and the entry veto are off unless a caller turns them on.
Neither one is a vote. A read taken after the decision is ignored. A missing
read is not a veto and adds zeros to the readout suffix. Nothing here sends
an order.
"""
from __future__ import annotations

import json
import math
import time
from datetime import datetime, timezone
from pathlib import Path

from .holder_capture import mints_from_records, read_is_due
from .jupiter_tokens import BATCH_LIMIT, TOP_HOLDERS_PERCENT, fetch_search, search_url
from .snapshot_feed import SnapshotError, load_snapshot, resolve_root, snapshot_files

FRESH_MS = 15 * 60 * 1000
RETRY_MS = 5 * 60 * 1000
PENDING_LIMIT = BATCH_LIMIT
SNAPSHOT_WINDOW = 6
HOLDOUT_MS = 4 * 60 * 60 * 1000
MIN_SPLIT_MS = 8 * 60 * 60 * 1000
HOLDER_LOG_CAP = 1_000_000
TRADER_LOG_CAP = 10_000
FEATURE_NAMES = (
    "present",
    "organic_score",
    "holder_count",
    "top_holders",
    "mint_authority_disabled",
    "freeze_authority_disabled",
    "imbalance_5m",
    "traders_5m",
    "imbalance_1h",
    "traders_1h",
)
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
    folder = root / "jupiter-tokens"
    folder.mkdir(parents=True, exist_ok=True)
    return folder / f"{day}.jsonl"


def append_read(root: Path, record: dict) -> None:
    stamp = record.get("read_ts_ms")
    if type(stamp) is not int or isinstance(stamp, bool) or stamp < 0:
        raise ValueError("MISSING_READ_TS")
    if type(record.get("mint")) is not str or type(record.get("source")) is not str:
        raise ValueError("JUPITER_LOG_SCHEMA")
    if record.get("status") not in {"AVAILABLE", "NOT_OBSERVED"}:
        raise ValueError("JUPITER_LOG_SCHEMA")
    line = json.dumps(record, sort_keys=True, separators=(",", ":"))
    with _log_path(root, stamp).open("a", encoding="utf-8") as handle:
        handle.write(line + "\n")


def load_jupiter_reads(root: Path) -> dict[str, list[dict]]:
    """JSONL reads beside the snapshots, grouped by mint and ordered by read_ts_ms."""
    folder = Path(root) / "jupiter-tokens"
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
                    raise ValueError(f"JUPITER_LOG_SCHEMA:{path.name}:{line_number}") from error
                if type(row) is not dict or type(row.get("mint")) is not str:
                    raise ValueError(f"JUPITER_LOG_SCHEMA:{path.name}:{line_number}")
                grouped.setdefault(row["mint"], []).append(row)
    for rows in grouped.values():
        rows.sort(key=lambda item: item["read_ts_ms"] if type(item.get("read_ts_ms")) is int and not isinstance(item.get("read_ts_ms"), bool) else -1)
    return grouped


def join_jupiter_read(rows, now_ms: int):
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
        if type(mint) is not str or not mint or mint in seen:
            continue
        try:
            search_url([mint])
        except SnapshotError:
            continue
        seen.add(mint)
        rows.append({
            "mint": mint,
            "symbol": data.get("symbol") if type(data.get("symbol")) is str else None,
            "volume_h1": None,
            "thesis": True,
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
    """Thesis mints and mints in the newest snapshots, capped."""
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
    grouped = load_jupiter_reads(root) if reads is None else reads
    theses = {item["mint"]: item for item in _thesis_candidates(root)}
    seen = set()
    rows = []
    for relative in reversed(files):
        for item in mints_from_records(load_snapshot(root, relative)):
            if item["mint"] in seen:
                continue
            try:
                search_url([item["mint"]])
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
    status = "AVAILABLE" if result.get("status") == "AVAILABLE" else "NOT_OBSERVED"
    body = {
        "protocol": "AAI_JUPITER_TOKENS_V1",
        "status": status,
        "reason": result.get("reason"),
        "mint": item["mint"],
        "symbol": item.get("symbol") if type(item.get("symbol")) is str else None,
        "source": result.get("url") or search_url([item["mint"]]),
        "read_ts_ms": read_ts_ms,
        "read_ts": _iso(read_ts_ms),
        "snapshot_file": item.get("snapshot_file"),
        "thesis": item.get("thesis") is True,
        "raw": result.get("raw") if status == "AVAILABLE" else None,
        "features": result.get("features") if status == "AVAILABLE" else None,
        "body_sha256": result.get("body_sha256"),
        "retries": result.get("retries") if type(result.get("retries")) is int else 0,
        "action": "NO_EXECUTION",
        "execution_allowed": False,
        "live_orders": False,
    }
    if type(body["symbol"]) is not str and type(result.get("raw")) is dict and type(result["raw"].get("symbol")) is str:
        body["symbol"] = result["raw"]["symbol"]
    for key in ("http_status", "retry_after_seconds"):
        value = result.get(key)
        if type(value) is int and not isinstance(value, bool):
            body[key] = value
    if status != "AVAILABLE":
        body["raw"] = None
        body["features"] = None
    return body


def capture_jupiter_tokens(
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
    """Append Jupiter token reads for candidate mints. Paper only."""
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
    for offset in range(0, len(selected), BATCH_LIMIT):
        chunk = selected[offset:offset + BATCH_LIMIT]
        if offset and interval_s:
            sleep(interval_s)
        found = fetch_search([item["mint"] for item in chunk], transport=transport, sleep=sleep)
        read_ts_ms = clock()
        for item in chunk:
            record = _stamp(found[item["mint"]], item, read_ts_ms)
            append_read(root, record)
            stored.append(record["mint"])
            if record["status"] == "AVAILABLE":
                succeeded += 1
            else:
                not_observed_count += 1
    return {
        "protocol": "AAI_JUPITER_TOKEN_CAPTURE_V1",
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
        "batch_limit": BATCH_LIMIT,
        "started_ms": started,
        "started_at": _iso(started) if type(started) is int else None,
        "action": "NO_EXECUTION",
        "execution_allowed": False,
        "live_orders": False,
    }


def jupiter_veto_reasons(read, now_ms: int) -> tuple[list[str], dict]:
    """Skip reasons from one causal Jupiter read. An empty list means no gate fired.

    Freeze authority still enabled, mint authority still enabled, or a
    top-holder percentage at or above 50. The percentage is the unit returned
    by the search (a live SOL row was about 0.58 and a live pump row was about
    4.7, so 50 means half the supply). A later read, a NOT_OBSERVED read, and
    a missing field add nothing. Organic score is not a veto.
    """
    reasons = []
    evidence = {}
    if type(now_ms) is not int or isinstance(now_ms, bool) or type(read) is not dict:
        return reasons, evidence
    if read.get("status") != "AVAILABLE":
        return reasons, evidence
    stamp = read.get("read_ts_ms")
    features = read.get("features")
    if type(stamp) is not int or isinstance(stamp, bool) or stamp > now_ms or type(features) is not dict:
        return reasons, evidence
    if features.get("freeze_authority_disabled") is False:
        reasons.append("JUPITER_FREEZE_AUTHORITY")
    if features.get("mint_authority_disabled") is False:
        reasons.append("JUPITER_MINT_AUTHORITY")
    share = features.get("top_holders_percentage")
    if type(share) in (int, float) and not isinstance(share, bool) and share >= TOP_HOLDERS_PERCENT:
        reasons.append("JUPITER_TOP_HOLDERS")
    if reasons:
        evidence = {
            "jupiter_read_ts_ms": stamp,
            "freeze_authority_disabled": features.get("freeze_authority_disabled"),
            "mint_authority_disabled": features.get("mint_authority_disabled"),
            "top_holders_percentage": share,
            "rule_top_holders_percentage": TOP_HOLDERS_PERCENT,
        }
    return reasons, evidence


def _clip(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _unit(value) -> float:
    if type(value) is bool or type(value) not in (int, float) or not math.isfinite(float(value)):
        return 0.0
    return _clip(float(value), 0.0, 1.0) * 2.0 - 1.0


def _log_unit(value, cap: int) -> float:
    if type(value) is bool or type(value) not in (int, float) or not math.isfinite(float(value)) or value < 0:
        return 0.0
    return _unit(math.log1p(float(value)) / math.log1p(cap))


def _imbalance(buy, sell) -> float:
    if type(buy) is bool or type(sell) is bool or type(buy) not in (int, float) or type(sell) not in (int, float):
        return 0.0
    if not math.isfinite(float(buy)) or not math.isfinite(float(sell)) or buy < 0 or sell < 0:
        return 0.0
    total = float(buy) + float(sell)
    if total <= 0:
        return 0.0
    return _clip((float(buy) - float(sell)) / total, -1.0, 1.0)


def _flag(value) -> float:
    if value is True:
        return 1.0
    if value is False:
        return -1.0
    return 0.0


def readout_features(read, now_ms) -> list[float]:
    """Fixed suffix for a refit readout. Missing, late, and NOT_OBSERVED reads are zeros.

    Scales are fixed: organic score and top-holder percentage are divided by
    100, and holder and trader counts use ``log1p`` against 1000000 and 10000.
    They are not fit on closed trades. The first component is 1 only when an
    AVAILABLE read is at or before ``now_ms``.
    """
    blank = [0.0] * len(FEATURE_NAMES)
    if type(now_ms) is not int or isinstance(now_ms, bool):
        return blank
    if type(read) is not dict or read.get("status") != "AVAILABLE":
        return blank
    stamp = read.get("read_ts_ms")
    features = read.get("features")
    if type(stamp) is not int or isinstance(stamp, bool) or stamp > now_ms or type(features) is not dict:
        return blank
    organic = features.get("organic_score")
    organic_scaled = 0.0 if type(organic) is bool or type(organic) not in (int, float) else _unit(float(organic) / 100.0)
    top = features.get("top_holders_percentage")
    top_scaled = 0.0 if type(top) is bool or type(top) not in (int, float) else _unit(float(top) / 100.0)
    return [
        1.0,
        organic_scaled,
        _log_unit(features.get("holder_count"), HOLDER_LOG_CAP),
        top_scaled,
        _flag(features.get("mint_authority_disabled")),
        _flag(features.get("freeze_authority_disabled")),
        _imbalance(features.get("buy_volume_5m"), features.get("sell_volume_5m")),
        _log_unit(features.get("num_traders_5m"), TRADER_LOG_CAP),
        _imbalance(features.get("buy_volume_1h"), features.get("sell_volume_1h")),
        _log_unit(features.get("num_traders_1h"), TRADER_LOG_CAP),
    ]


def _count_side(decisions, reads, start_ms, end_ms) -> dict:
    joined = available = missed = vetoes = 0
    for row in decisions:
        stamp = row.get("ts_ms")
        if type(stamp) is not int or isinstance(stamp, bool):
            continue
        if stamp < start_ms or stamp >= end_ms:
            continue
        hit = join_jupiter_read(reads.get(row.get("mint"), []), stamp)
        if hit is None:
            continue
        joined += 1
        if hit.get("status") == "AVAILABLE":
            available += 1
            if jupiter_veto_reasons(hit, stamp)[0]:
                vetoes += 1
        elif hit.get("status") == "NOT_OBSERVED":
            missed += 1
    return {"joined": joined, "available": available, "not_observed": missed, "veto_fires": vetoes}


def coverage_report(root: Path, *, cutoff_file: str | None = None) -> dict:
    """Count causal Jupiter reads on readout decisions. This does not open a paper trade.

    A store that cannot hold an 8-hour train-plus-holdout split is not scored.
    The readout feature needs AVAILABLE reads on both sides of that split.
    Zero on either side means the with-and-without paper book was not estimated.
    """
    from .flyvis_market import decisions_from_series
    from .walk_forward import _stamped, load_series

    root = resolve_root(root)
    stamped = _stamped(root, cutoff_file, None)
    reads = load_jupiter_reads(root)
    stamps = [
        row.get("read_ts_ms")
        for rows in reads.values()
        for row in rows
        if type(row.get("read_ts_ms")) is int and not isinstance(row.get("read_ts_ms"), bool)
    ]
    report = {
        "protocol": "AAI_JUPITER_COVERAGE_V1",
        "mode": "PAPER",
        "action": "NO_EXECUTION",
        "execution_allowed": False,
        "live_orders": False,
        "cutoff_file": cutoff_file,
        "snapshot_files": len(stamped),
        "first_file": None if not stamped else stamped[0]["file"],
        "first_ts": None if not stamped else stamped[0]["ts"],
        "last_file": None if not stamped else stamped[-1]["file"],
        "last_ts": None if not stamped else stamped[-1]["ts"],
        "reads": len(stamps),
        "mints": len(reads),
        "first_read_ms": None if not stamps else min(stamps),
        "first_read_ts": None if not stamps else _iso(min(stamps)),
        "last_read_ms": None if not stamps else max(stamps),
        "last_read_ts": None if not stamps else _iso(max(stamps)),
        "readout_feature_default": False,
        "entry_veto_default": False,
        "evaluable": False,
    }
    if len(stamped) < 2:
        report["reason"] = "NEED_SNAPSHOTS"
        return report
    span = stamped[-1]["ms"] - stamped[0]["ms"]
    if span <= MIN_SPLIT_MS:
        report["reason"] = "STORE_SHORTER_THAN_EIGHT_HOURS"
        report["span_ms"] = span
        return report
    line = stamped[-1]["ms"] - HOLDOUT_MS
    holdout = next(item for item in stamped if item["ms"] >= line)
    series = load_series(root, [item["file"] for item in stamped])
    decisions = decisions_from_series(series)
    train = _count_side(decisions, reads, stamped[0]["ms"], holdout["ms"])
    hold = _count_side(decisions, reads, holdout["ms"], stamped[-1]["ms"] + 1)
    report.update({
        "span_ms": span,
        "holdout_start_ms": holdout["ms"],
        "holdout_start_ts": holdout["ts"],
        "holdout_file": holdout["file"],
        "decision_rows": len(decisions),
        "train": train,
        "holdout": hold,
    })
    report["reads_after_last_snapshot"] = bool(stamps) and min(stamps) > stamped[-1]["ms"]
    if train["available"] == 0 and hold["available"] == 0:
        report["reason"] = "NO_CAUSAL_READS"
    elif train["available"] == 0:
        report["reason"] = "NO_CAUSAL_TRAIN_READS"
    elif hold["available"] == 0:
        report["reason"] = "NO_CAUSAL_HOLDOUT_READS"
    else:
        report["evaluable"] = True
        report["reason"] = "CAUSAL_READS_ON_TRAIN_AND_HOLDOUT"
    return report
