"""SQLite kline cache."""
from __future__ import annotations

import sqlite3
from contextlib import closing, contextmanager
from pathlib import Path
from typing import Any

import pandas as pd

SCHEMA = """
CREATE TABLE IF NOT EXISTS klines (
  symbol TEXT NOT NULL, interval TEXT NOT NULL, open_time INTEGER NOT NULL,
  open REAL NOT NULL, high REAL NOT NULL, low REAL NOT NULL, close REAL NOT NULL,
  volume REAL NOT NULL, close_time INTEGER NOT NULL,
  PRIMARY KEY (symbol, interval, open_time)
);
"""


class KlineCache:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._conn() as c:
            c.executescript(SCHEMA)

    @contextmanager
    def _conn(self):
        with closing(sqlite3.connect(self.path)) as c:
            with c:
                yield c

    def upsert(self, symbol: str, interval: str, rows: list[list[Any]], now_ms: int | None = None) -> int:
        """Store only CLOSED candles (close_time < now)."""
        recs = []
        for r in rows:
            close_time = int(r[6])
            if now_ms is not None and close_time >= now_ms:
                continue
            recs.append((symbol, interval, int(r[0]), float(r[1]), float(r[2]), float(r[3]), float(r[4]),
                         float(r[5]), close_time))
        with self._conn() as c:
            c.executemany("INSERT OR REPLACE INTO klines VALUES (?,?,?,?,?,?,?,?,?)", recs)
        return len(recs)

    def last_open_time(self, symbol: str, interval: str) -> int | None:
        with self._conn() as c:
            row = c.execute("SELECT MAX(open_time) FROM klines WHERE symbol=? AND interval=?",
                            (symbol, interval)).fetchone()
        return row[0] if row and row[0] is not None else None

    def load(self, symbol: str, interval: str, start_ms: int | None = None, end_ms: int | None = None) -> pd.DataFrame:
        q = "SELECT open_time, open, high, low, close, volume FROM klines WHERE symbol=? AND interval=?"
        args: list[Any] = [symbol, interval]
        if start_ms is not None:
            q += " AND open_time >= ?"
            args.append(start_ms)
        if end_ms is not None:
            q += " AND open_time <= ?"
            args.append(end_ms)
        q += " ORDER BY open_time"
        with self._conn() as c:
            df = pd.read_sql_query(q, c, params=args)
        df["ts"] = pd.to_datetime(df["open_time"], unit="ms", utc=True)
        return df.set_index("ts")
