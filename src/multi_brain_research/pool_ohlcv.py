"""Minute candles for one Solana pool from the public GeckoTerminal OHLCV route.

The response list is newest first. Each row is
[unix_seconds, open, high, low, close, volume]. A row that is not that shape
is skipped. Nothing here invents a price. Redirects are refused by the shared
snapshot client. A 429 is returned as RATE_LIMITED after a short backoff.
"""
from __future__ import annotations

import json
import math
import time
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

from .snapshot_feed import SnapshotError, fetch_json

HOST = "https://api.geckoterminal.com"
WIDTH_MS = 60_000
_B58 = set("123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz")
_AGGREGATE = {"minute": frozenset({1, 5, 15}), "hour": frozenset({1, 4, 12}), "day": frozenset({1})}


def _address(value) -> bool:
    return type(value) is str and 32 <= len(value) <= 44 and all(ch in _B58 for ch in value)


def _finite(value):
    if type(value) is bool or type(value) not in (int, float):
        return None
    number = float(value)
    if not math.isfinite(number):
        return None
    return number


def ohlcv_url(pool: str, *, before_timestamp: int | None = None, limit: int = 100, aggregate: int = 1, timeframe: str = "minute") -> str:
    if not _address(pool):
        raise SnapshotError("BAD_POOL")
    if timeframe not in _AGGREGATE or type(aggregate) is not int or aggregate not in _AGGREGATE[timeframe]:
        raise SnapshotError("BAD_TIMEFRAME")
    if type(limit) is not int or not 1 <= limit <= 1000:
        raise SnapshotError("BAD_LIMIT")
    if before_timestamp is not None and (type(before_timestamp) is not int or isinstance(before_timestamp, bool) or before_timestamp < 0):
        raise SnapshotError("BAD_TIME")
    query = f"aggregate={aggregate}&limit={limit}&currency=usd&token=base"
    if before_timestamp is not None:
        query += f"&before_timestamp={before_timestamp}"
    return f"{HOST}/api/v2/networks/solana/pools/{pool}/ohlcv/{timeframe}?{query}"


def parse_ohlcv(payload) -> list[dict]:
    """Candles in time order. Malformed rows are omitted, not repaired."""
    if type(payload) is not dict:
        raise SnapshotError("OHLCV_SCHEMA")
    data = payload.get("data")
    attributes = data.get("attributes") if type(data) is dict else None
    rows = attributes.get("ohlcv_list") if type(attributes) is dict else None
    if type(rows) is not list:
        raise SnapshotError("OHLCV_SCHEMA")
    candles = []
    for row in rows:
        if type(row) is not list or len(row) < 6:
            continue
        stamp = row[0]
        if type(stamp) is not int or isinstance(stamp, bool) or stamp < 0:
            continue
        numbers = [_finite(value) for value in row[1:6]]
        if any(value is None for value in numbers):
            continue
        open_, high, low, close, volume = numbers
        if high < low:
            continue
        candles.append({
            "ts_ms": stamp * 1000,
            "open": open_,
            "high": high,
            "low": low,
            "close": close,
            "volume": volume,
        })
    candles.sort(key=lambda item: item["ts_ms"])
    return candles


def _retry_after(error: urllib.error.HTTPError):
    header = error.headers.get("Retry-After") if error.headers is not None else None
    if type(header) is str and header.strip().isdigit():
        return min(30, int(header.strip()))
    return None


def fetch_ohlcv(pool: str, *, before_timestamp: int | None = None, limit: int = 100, aggregate: int = 1, timeframe: str = "minute", transport=None, sleep=time.sleep, attempts: int = 3) -> dict:
    """Read one OHLCV page. A failed read has an empty candle list."""
    url = ohlcv_url(pool, before_timestamp=before_timestamp, limit=limit, aggregate=aggregate, timeframe=timeframe)
    if type(attempts) is not int or attempts < 1:
        raise SnapshotError("BAD_ATTEMPTS")
    last = None
    for attempt in range(attempts):
        try:
            payload = fetch_json(url, transport)
        except urllib.error.HTTPError as error:
            reason = "RATE_LIMITED" if error.code == 429 else "HTTP_ERROR"
            retry = _retry_after(error)
            last = {
                "status": "UNAVAILABLE",
                "reason": reason,
                "http_status": error.code,
                "retry_after_seconds": retry,
                "url": url,
                "candles": [],
                "action": "NO_EXECUTION",
            }
            error.close()
            if reason == "RATE_LIMITED" and attempt + 1 < attempts:
                sleep(2 if retry is None else retry)
                continue
            return last
        except (SnapshotError, urllib.error.URLError, TimeoutError, json.JSONDecodeError):
            return {
                "status": "UNAVAILABLE",
                "reason": "OHLCV_UNAVAILABLE",
                "url": url,
                "candles": [],
                "action": "NO_EXECUTION",
            }
        try:
            candles = parse_ohlcv(payload)
        except SnapshotError:
            return {
                "status": "UNAVAILABLE",
                "reason": "OHLCV_SCHEMA",
                "url": url,
                "candles": [],
                "action": "NO_EXECUTION",
            }
        return {
            "status": "OBSERVED",
            "reason": None,
            "url": url,
            "candles": candles,
            "action": "NO_EXECUTION",
            "execution_allowed": False,
        }
    return last


def candles_in_window(candles: list[dict], opened_ms: int, now_ms: int, *, width_ms: int = WIDTH_MS) -> list[dict]:
    """Candles that start at or after the open and end at or before the decision."""
    chosen = []
    for candle in candles:
        start = candle.get("ts_ms")
        if type(start) is not int or isinstance(start, bool):
            continue
        if opened_ms <= start and start + width_ms <= now_ms:
            chosen.append(candle)
    chosen.sort(key=lambda item: item["ts_ms"])
    return chosen


def write_jsonl(path: Path, result: dict, *, pool: str, fetched_at: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = [{
        "kind": "OHLCV_META",
        "pool": pool,
        "url": result.get("url"),
        "status": result.get("status"),
        "reason": result.get("reason"),
        "timeframe": "minute",
        "aggregate": 1,
        "width_ms": WIDTH_MS,
        "fetched_at": fetched_at,
        "action": "NO_EXECUTION",
    }]
    for candle in result.get("candles") or []:
        lines.append({"kind": "OHLCV_CANDLE", **candle, "action": "NO_EXECUTION"})
    path.write_text("".join(json.dumps(line, sort_keys=True) + "\n" for line in lines), encoding="utf-8")


def load_jsonl(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    candles = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        if type(row) is not dict or row.get("kind") != "OHLCV_CANDLE":
            continue
        if type(row.get("ts_ms")) is not int:
            continue
        numbers = [_finite(row.get(name)) for name in ("open", "high", "low", "close", "volume")]
        if any(value is None for value in numbers):
            continue
        candles.append({
            "ts_ms": row["ts_ms"],
            "open": numbers[0],
            "high": numbers[1],
            "low": numbers[2],
            "close": numbers[3],
            "volume": numbers[4],
        })
    candles.sort(key=lambda item: item["ts_ms"])
    return candles


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
