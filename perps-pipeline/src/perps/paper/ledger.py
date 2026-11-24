"""SQLite ledger for paper trading (single file, transactional, cron-safe)."""

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from ..core.position import Position

SCHEMA = """
CREATE TABLE IF NOT EXISTS account (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, status TEXT NOT NULL, strategy TEXT NOT NULL, timeframe TEXT NOT NULL,
  symbol TEXT NOT NULL, side INTEGER NOT NULL, opened_at TEXT NOT NULL, closed_at TEXT, entry_price REAL NOT NULL,
  exit_price REAL, exit_reason TEXT, gross_pnl REAL, fees REAL, funding REAL, net_pnl REAL, r_multiple REAL,
  data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS cursors (strategy TEXT, timeframe TEXT, symbol TEXT, last_bar_ts INTEGER,
  PRIMARY KEY (strategy, timeframe, symbol));
CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, kind TEXT NOT NULL,
  payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS equity (ts TEXT NOT NULL, equity REAL, cash REAL, unrealized REAL);
"""


def utcnow() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


class Ledger:
    def __init__(self, path: Path | str, initial_equity: float = 100.0) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(self.path, timeout=30)
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(SCHEMA)
        if self.get("cash") is None:
            with self.tx():
                self.set("cash", initial_equity)
                self.set("initial_equity", initial_equity)
                self.set("peak_equity", initial_equity)
                self.set("created_at", utcnow())

    @contextmanager
    def tx(self):
        try:
            yield self.conn
            self.conn.commit()
        except Exception:
            self.conn.rollback()
            raise

    def close(self) -> None:
        self.conn.close()

    # ---- account kv ---------------------------------------------------------------------
    def get(self, key: str, default: Any = None) -> Any:
        row = self.conn.execute("SELECT value FROM account WHERE key=?", (key,)).fetchone()
        return json.loads(row["value"]) if row else default

    def set(self, key: str, value: Any) -> None:
        self.conn.execute("INSERT INTO account(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                          (key, json.dumps(value)))

    # ---- positions ----------------------------------------------------------------------
    def open_positions(self) -> list[tuple[int, Position]]:
        rows = self.conn.execute("SELECT id, data FROM positions WHERE status='open' ORDER BY id").fetchall()
        return [(r["id"], Position(**json.loads(r["data"]))) for r in rows]

    def insert_position(self, p: Position) -> int:
        cur = self.conn.execute(
            "INSERT INTO positions(status,strategy,timeframe,symbol,side,opened_at,entry_price,data) "
            "VALUES('open',?,?,?,?,?,?,?)",
            (p.strategy, p.timeframe, p.symbol, p.side, p.entry_time, p.entry_price, json.dumps(p.to_dict())))
        return int(cur.lastrowid or 0)

    def update_position(self, pid: int, p: Position) -> None:
        self.conn.execute("UPDATE positions SET data=? WHERE id=?", (json.dumps(p.to_dict()), pid))

    def close_position(self, pid: int, p: Position, closed_at: str, exit_price: float, reason: str, gross: float,
                       fees: float, net: float) -> None:
        r = net / p.risk_amount if p.risk_amount > 0 else None
        self.conn.execute(
            "UPDATE positions SET status='closed', closed_at=?, exit_price=?, exit_reason=?, gross_pnl=?, fees=?, "
            "funding=?, net_pnl=?, r_multiple=?, data=? WHERE id=?",
            (closed_at, exit_price, reason, gross, fees, p.funding, net, r, json.dumps(p.to_dict()), pid))

    def closed_positions(self, limit: int = 1000) -> list[dict]:
        rows = self.conn.execute("SELECT * FROM positions WHERE status='closed' ORDER BY id DESC LIMIT ?",
                                 (limit,)).fetchall()
        return [{k: r[k] for k in r.keys() if k != "data"} for r in rows]  # noqa: SIM118 (sqlite3.Row)

    # ---- cursors / events / equity ------------------------------------------------------
    def cursor(self, strategy: str, timeframe: str, symbol: str) -> int | None:
        row = self.conn.execute("SELECT last_bar_ts FROM cursors WHERE strategy=? AND timeframe=? AND symbol=?",
                                (strategy, timeframe, symbol)).fetchone()
        return int(row["last_bar_ts"]) if row else None

    def set_cursor(self, strategy: str, timeframe: str, symbol: str, ts: int) -> None:
        self.conn.execute("INSERT INTO cursors VALUES(?,?,?,?) ON CONFLICT(strategy,timeframe,symbol) "
                          "DO UPDATE SET last_bar_ts=excluded.last_bar_ts", (strategy, timeframe, symbol, ts))

    def event(self, kind: str, payload: dict) -> None:
        self.conn.execute("INSERT INTO events(ts,kind,payload) VALUES(?,?,?)",
                          (utcnow(), kind, json.dumps(payload, default=str)))

    def recent_events(self, limit: int = 20) -> list[dict]:
        rows = self.conn.execute("SELECT ts, kind, payload FROM events ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
        return [{"ts": r["ts"], "kind": r["kind"], **json.loads(r["payload"])} for r in rows]

    def snapshot_equity(self, equity: float, cash: float, unrealized: float) -> None:
        self.conn.execute("INSERT INTO equity VALUES(?,?,?,?)", (utcnow(), equity, cash, unrealized))
