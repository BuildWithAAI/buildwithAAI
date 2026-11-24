"""Backtest work store (SQLite, resumable): sampled candidates, labels and scored rows."""
from __future__ import annotations
import json, sqlite3, threading

SCHEMA = """
CREATE TABLE IF NOT EXISTS candidates (
  create_sig TEXT PRIMARY KEY, mint TEXT, create_time INTEGER, slot INTEGER, creator TEXT, curve TEXT,
  txs_first_5m INTEGER, eligible INTEGER, checked_at REAL, note TEXT);
CREATE TABLE IF NOT EXISTS labels (mint TEXT PRIMARY KEY, as_of INTEGER, doc TEXT);
CREATE TABLE IF NOT EXISTS scored (mint TEXT PRIMARY KEY, as_of INTEGER, doc TEXT, error TEXT, scored_at REAL, elapsed_s REAL);
"""


class Store:
    def __init__(self, path):
        self.db = sqlite3.connect(path, timeout=60, check_same_thread=False)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.executescript(SCHEMA)
        self.lock = threading.Lock()

    def q(self, sql, args=()):
        with self.lock:
            return self.db.execute(sql, args).fetchall()

    def x(self, sql, args=()):
        with self.lock:
            self.db.execute(sql, args); self.db.commit()

    def put_label(self, mint, as_of, doc):
        self.x("INSERT OR REPLACE INTO labels VALUES (?,?,?)", (mint, as_of, json.dumps(doc)))

    def put_scored(self, mint, as_of, doc, error, scored_at, elapsed):
        self.x("INSERT OR REPLACE INTO scored VALUES (?,?,?,?,?,?)", (mint, as_of, json.dumps(doc) if doc else None, error, scored_at, elapsed))
