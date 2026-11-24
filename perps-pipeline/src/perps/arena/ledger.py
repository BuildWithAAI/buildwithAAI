"""SQLite ledger for the arena: per-arm sub-accounts, trades (open + closed, full journal), resting
simulated maker orders, cursors, equity marks and an event log. Simulated bookkeeping only."""

from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

SCHEMA = """
CREATE TABLE IF NOT EXISTS arms (
  name TEXT PRIMARY KEY, cash REAL NOT NULL, initial REAL NOT NULL, peak REAL NOT NULL,
  day TEXT NOT NULL DEFAULT '', day_start REAL NOT NULL, killed INTEGER NOT NULL DEFAULT 0,
  kill_reason TEXT NOT NULL DEFAULT '', benched INTEGER NOT NULL DEFAULT 0, created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT, arm TEXT NOT NULL, symbol TEXT NOT NULL, status TEXT NOT NULL,
  entry_time TEXT NOT NULL, exit_time TEXT, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS trades_arm ON trades(arm, status);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT, arm TEXT NOT NULL, symbol TEXT NOT NULL, status TEXT NOT NULL,
  created TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS cursors (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS equity (ts TEXT NOT NULL, arm TEXT NOT NULL, equity REAL NOT NULL, cash REAL NOT NULL,
  open_positions INTEGER NOT NULL, PRIMARY KEY (ts, arm));
CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, arm TEXT, kind TEXT NOT NULL,
  message TEXT NOT NULL, data TEXT);
"""


def utcnow() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


class ArenaLedger:
    def __init__(self, path: Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(self.path, timeout=30)
        self.db.row_factory = sqlite3.Row
        self.db.executescript(SCHEMA)
        self.db.commit()

    def close(self) -> None:
        self.db.close()

    def commit(self) -> None:
        self.db.commit()

    # ------------------------------------------------------------------ arms
    def ensure_arm(self, name: str, initial: float) -> None:
        self.db.execute("INSERT OR IGNORE INTO arms(name, cash, initial, peak, day_start, created) VALUES (?,?,?,?,?,?)",
                        (name, initial, initial, initial, initial, utcnow()))

    def arm(self, name: str) -> dict[str, Any]:
        row = self.db.execute("SELECT * FROM arms WHERE name=?", (name,)).fetchone()
        if row is None:
            raise KeyError(name)
        return dict(row)

    def arms(self) -> list[dict[str, Any]]:
        return [dict(r) for r in self.db.execute("SELECT * FROM arms ORDER BY name")]

    def update_arm(self, name: str, **fields: Any) -> None:
        cols = ", ".join(f"{k}=?" for k in fields)
        self.db.execute(f"UPDATE arms SET {cols} WHERE name=?", (*fields.values(), name))

    def add_cash(self, name: str, delta: float) -> None:
        self.db.execute("UPDATE arms SET cash = cash + ? WHERE name=?", (delta, name))

    # ------------------------------------------------------------------ trades
    def insert_trade(self, t: dict[str, Any]) -> int:
        cur = self.db.execute("INSERT INTO trades(arm, symbol, status, entry_time, exit_time, data) VALUES (?,?,?,?,?,?)",
                              (t["arm"], t["symbol"], t["status"], t["entry_time"], t.get("exit_time"), "{}"))
        tid = int(cur.lastrowid or 0)
        t["id"] = tid
        self.save_trade(t)
        return tid

    def save_trade(self, t: dict[str, Any]) -> None:
        self.db.execute("UPDATE trades SET status=?, exit_time=?, data=? WHERE id=?",
                        (t["status"], t.get("exit_time"), json.dumps(t, default=float), t["id"]))

    def trades(self, arm: str | None = None, status: str | None = None) -> list[dict[str, Any]]:
        q, args = "SELECT data FROM trades WHERE 1=1", []
        if arm:
            q += " AND arm=?"
            args.append(arm)
        if status:
            q += " AND status=?"
            args.append(status)
        return [json.loads(r["data"]) for r in self.db.execute(q + " ORDER BY id", args)]

    def trade(self, tid: int) -> dict[str, Any] | None:
        r = self.db.execute("SELECT data FROM trades WHERE id=?", (tid,)).fetchone()
        return json.loads(r["data"]) if r else None

    # ------------------------------------------------------------------ orders
    def insert_order(self, o: dict[str, Any]) -> int:
        cur = self.db.execute("INSERT INTO orders(arm, symbol, status, created, data) VALUES (?,?,?,?,?)",
                              (o["arm"], o["symbol"], o["status"], o["created"], "{}"))
        o["id"] = int(cur.lastrowid or 0)
        self.save_order(o)
        return o["id"]

    def save_order(self, o: dict[str, Any]) -> None:
        self.db.execute("UPDATE orders SET status=?, data=? WHERE id=?", (o["status"], json.dumps(o, default=float),
                                                                         o["id"]))

    def orders(self, arm: str | None = None, status: str | None = "open") -> list[dict[str, Any]]:
        q, args = "SELECT data FROM orders WHERE 1=1", []
        if arm:
            q += " AND arm=?"
            args.append(arm)
        if status:
            q += " AND status=?"
            args.append(status)
        return [json.loads(r["data"]) for r in self.db.execute(q + " ORDER BY id", args)]

    # ------------------------------------------------------------------ misc
    def get_cursor(self, key: str, default: str | None = None) -> str | None:
        r = self.db.execute("SELECT value FROM cursors WHERE key=?", (key,)).fetchone()
        return r["value"] if r else default

    def set_cursor(self, key: str, value: Any) -> None:
        self.db.execute("INSERT INTO cursors(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                        (key, str(value)))

    def event(self, kind: str, message: str, arm: str | None = None, data: dict | None = None) -> None:
        self.db.execute("INSERT INTO events(ts, arm, kind, message, data) VALUES (?,?,?,?,?)",
                        (utcnow(), arm, kind, message, json.dumps(data, default=str) if data else None))

    def events(self, limit: int = 50) -> list[dict[str, Any]]:
        return [dict(r) for r in self.db.execute("SELECT * FROM events ORDER BY id DESC LIMIT ?", (limit,))]

    def mark_equity(self, ts: str, arm: str, equity: float, cash: float, n_open: int) -> None:
        self.db.execute("INSERT OR REPLACE INTO equity(ts, arm, equity, cash, open_positions) VALUES (?,?,?,?,?)",
                        (ts, arm, equity, cash, n_open))
