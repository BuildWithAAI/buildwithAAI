#!/usr/bin/env python3
"""Read-only export of one civil day of Zoora's diary, feed, and (optional) live snapshot.

Safe for episode research: no secrets, no wallet keys, no live ledger rows.
Works against a local Lumen SQLite file and, optionally, GET /now /status /feed /memory /api/world.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import urllib.error
import urllib.request
from datetime import datetime, time, timedelta, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

TZ = ZoneInfo("America/Chicago")
BLOCK_KEYS = {
    "provider",
    "providertransactionid",
    "paymentintentid",
    "chargeid",
    "idempotencykey",
    "bodyhash",
    "entryhash",
    "prevhash",
    "contenthash",
    "wallet",
    "address",
    "seed",
    "secret",
    "token",
    "authorization",
    "apikey",
    "privatekey",
}


def day_bounds(day: str) -> tuple[int, int, str]:
    start = datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=TZ)
    end = start + timedelta(days=1)
    return int(start.timestamp() * 1000), int(end.timestamp() * 1000), start.isoformat()


def iso(ms: int | None) -> str | None:
    if ms is None:
        return None
    try:
        return datetime.fromtimestamp(ms / 1000, tz=TZ).isoformat()
    except (OSError, OverflowError, ValueError):
        return None


def connect(path: Path) -> sqlite3.Connection:
    # Read-only, including WAL, so a running Lumen process can keep the file.
    uri = path.resolve().as_uri() + "?mode=ro"
    conn = sqlite3.connect(uri, uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def table_exists(conn: sqlite3.Connection, name: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)
    ).fetchone()
    return row is not None


def columns(conn: sqlite3.Connection, name: str) -> set[str]:
    return {r[1] for r in conn.execute(f"PRAGMA table_info({name})")}


def fetch_day(conn: sqlite3.Connection, table: str, start: int, end: int, where: str = "1=1") -> list[dict[str, Any]]:
    if not table_exists(conn, table):
        return []
    cols = columns(conn, table)
    time_col = "created_at" if "created_at" in cols else ("at_ms" if "at_ms" in cols else None)
    if not time_col:
        return []
    sql = f"SELECT * FROM {table} WHERE {where} AND {time_col} >= ? AND {time_col} < ? ORDER BY {time_col} ASC, rowid ASC"
    rows = []
    for raw in conn.execute(sql, (start, end)):
        item = {k: raw[k] for k in raw.keys()}
        if time_col in item:
            item["created_at_iso_chicago"] = iso(item[time_col])
        rows.append(item)
    return rows


def get_json(url: str, timeout: float = 8.0) -> Any:
    req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "zoora-style-export/1"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = resp.read()
    return json.loads(body.decode("utf-8"))


def strip_blocked(value: Any) -> Any:
    if isinstance(value, dict):
        out = {}
        for key, item in value.items():
            compact = "".join(ch for ch in str(key).lower() if ch.isalnum())
            if compact in BLOCK_KEYS or "wallet" in compact or compact.endswith("token") or compact.endswith("secret"):
                continue
            out[key] = strip_blocked(item)
        return out
    if isinstance(value, list):
        return [strip_blocked(item) for item in value]
    return value


def simulated_trades(conn: sqlite3.Connection, start: int, end: int) -> list[dict[str, Any]]:
    if not table_exists(conn, "paper_trades"):
        return []
    cols = columns(conn, "paper_trades")
    time_col = "created_at" if "created_at" in cols else None
    if not time_col:
        return []
    rows = conn.execute(
        f"SELECT * FROM paper_trades WHERE {time_col} >= ? AND {time_col} < ? ORDER BY {time_col} ASC",
        (start, end),
    )
    out = []
    for raw in rows:
        mode = str(raw["mode"] if "mode" in raw.keys() else "")
        if mode.lower() == "live":
            continue
        symbol = str(raw["symbol"] if "symbol" in raw.keys() else "?")
        side = str(raw["side"] if "side" in raw.keys() else "?")
        if not symbol.isalnum() or len(symbol) > 12:
            continue
        if side not in {"buy", "sell"}:
            continue
        out.append(
            {
                "label": f"SIMULATED {symbol} {side}",
                "sim": True,
                "mode": mode,
                "created_at": raw[time_col],
                "created_at_iso_chicago": iso(raw[time_col]),
            }
        )
    return out


def thought_candidates(diary: list[dict[str, Any]], feed: list[dict[str, Any]]) -> list[str]:
    lines: list[str] = []
    for row in diary:
        text = (row.get("text") or "").strip()
        if text:
            lines.append(text)
    for row in feed:
        if row.get("kind") in {"action", "did"}:
            text = (row.get("text") or "").strip()
            if text:
                lines.append(text)
    # Unique, keep order
    seen: set[str] = set()
    unique = []
    for line in lines:
        if line not in seen:
            seen.add(line)
            unique.append(line)
    return unique[:24] or ["I'm drifting in the bowl."]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--day", required=True, help="Civil date YYYY-MM-DD in America/Chicago")
    parser.add_argument("--db", default="/workspace/zoora-style/data/lumen-88.sqlite", help="LUMEN_DATA sqlite path")
    parser.add_argument("--base-url", default="", help="Optional local origin, e.g. http://127.0.0.1:3000")
    parser.add_argument("--out", default="", help="Write JSON here; default stdout")
    args = parser.parse_args()

    start, end, day_iso = day_bounds(args.day)
    db_path = Path(args.db)
    if not db_path.exists():
        print(f"database not found: {db_path}", file=sys.stderr)
        return 2

    conn = connect(db_path)
    try:
        diary = fetch_day(conn, "diary", start, end, "private = 0")
        # Drop any unexpected private flag if the where clause was ignored
        diary = [row for row in diary if int(row.get("private") or 0) == 0]
        for row in diary:
            row.pop("private", None)
        feed = fetch_day(conn, "feed", start, end)
        world_log = fetch_day(conn, "world_log", start, end)
        payload: dict[str, Any] = {
            "date": args.day,
            "timezone": "America/Chicago",
            "day_starts_at": day_iso,
            "source": {
                "db": str(db_path.resolve()),
                "read_only": True,
                "live_money": False,
                "note": "Diary, feed, and thoughts only. Ledger, wallets, and provider ids are omitted. Paper trades are labels only.",
            },
            "diary": diary,
            "feed": feed,
            "world_log": world_log,
            "thought_candidates": thought_candidates(diary, feed),
            "simulated_trades": simulated_trades(conn, start, end),
        }
    finally:
        conn.close()

    if args.base_url:
        origin = args.base_url.rstrip("/")
        live: dict[str, Any] = {}
        for route in ("/now", "/status", "/feed", "/memory", "/api/world"):
            try:
                live[route] = strip_blocked(get_json(origin + route))
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, urllib.error.HTTPError) as exc:
                live[route] = {"error": str(exc)}
        # /api/world tape is kept so an episode can say PAPER vs LIVE, but drop deep money
        world = live.get("/api/world")
        if isinstance(world, dict):
            world.pop("shop", None)
        payload["live_snapshot"] = live
        payload["source"]["base_url"] = origin

    text = json.dumps(payload, indent=2, ensure_ascii=False)
    if args.out:
        Path(args.out).write_text(text + "\n", encoding="utf-8")
    else:
        sys.stdout.write(text + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
