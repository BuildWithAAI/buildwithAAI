"""Single-operator, persistent watches, observation history, and bot offsets."""
import json
import os
import sqlite3
import threading
from pathlib import Path
from .evidence import now
from .mint import decode_address


class Store:
    def __init__(self, path):
        self.path = path
        if path != ":memory:":
            target = Path(path)
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            if target.is_symlink():
                raise ValueError("Database path must not be a symlink")
        self.lock = threading.RLock()
        self.db = sqlite3.connect(path, check_same_thread=False, timeout=5)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA busy_timeout=5000")
        version = self.db.execute("PRAGMA user_version").fetchone()[0]
        if version not in (0, 1):
            self.db.close()
            raise ValueError("Unsupported scanner database schema")
        with self.db:
            self.db.executescript("""
                CREATE TABLE IF NOT EXISTS watches(mint TEXT PRIMARY KEY, created_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS observations(
                    id INTEGER PRIMARY KEY, mint TEXT NOT NULL, available_at TEXT NOT NULL, report TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS observations_mint ON observations(mint, id);
                CREATE TABLE IF NOT EXISTS state(key TEXT PRIMARY KEY, value TEXT NOT NULL);
                PRAGMA user_version=1;
            """)
        if path != ":memory:":
            os.chmod(path, 0o600)

    def close(self):
        with self.lock:
            self.db.close()

    def add_watch(self, mint):
        decode_address(mint)
        with self.lock, self.db:
            if len(self.watches()) >= 100 and not self.db.execute("SELECT 1 FROM watches WHERE mint=?", (mint,)).fetchone():
                raise ValueError("Watchlist limit is 100 tokens")
            self.db.execute("INSERT OR IGNORE INTO watches VALUES (?,?)", (mint, now()))

    def delete_watch(self, mint):
        decode_address(mint)
        with self.lock, self.db:
            self.db.execute("DELETE FROM watches WHERE mint=?", (mint,))

    def watches(self):
        with self.lock:
            return [{"mint": row[0], "created_at": row[1]} for row in self.db.execute(
                "SELECT mint,created_at FROM watches ORDER BY created_at DESC")]

    def save(self, report):
        mint = report["mint"]
        with self.lock, self.db:
            self.db.execute("INSERT INTO observations(mint,available_at,report) VALUES(?,?,?)",
                            (mint, report["available_at"], json.dumps(report, allow_nan=False)))
            self.db.execute("DELETE FROM observations WHERE mint=? AND id NOT IN "
                            "(SELECT id FROM observations WHERE mint=? ORDER BY id DESC LIMIT 100)", (mint, mint))
            self.db.execute("DELETE FROM observations WHERE id NOT IN "
                            "(SELECT id FROM observations ORDER BY id DESC LIMIT 5000)")

    def history(self, mint):
        decode_address(mint)
        with self.lock:
            reports = [json.loads(row[0]) for row in self.db.execute(
                "SELECT report FROM observations WHERE mint=? ORDER BY id DESC LIMIT 100", (mint,))]
        return [{"available_at": report["available_at"], "status": report["status"],
                 "price_usd": report["market"]["price_usd"],
                 "price_sol": report["market"]["price_sol"]} for report in reversed(reports)]

    def set_state(self, key, value):
        with self.lock, self.db:
            self.db.execute("INSERT OR REPLACE INTO state VALUES(?,?)", (key, str(value)))

    def get_state(self, key, default=None):
        with self.lock:
            row = self.db.execute("SELECT value FROM state WHERE key=?", (key,)).fetchone()
        return row[0] if row else default

    def counts(self):
        with self.lock:
            return {"watches": self.db.execute("SELECT count(*) FROM watches").fetchone()[0],
                    "observations": self.db.execute("SELECT count(*) FROM observations").fetchone()[0]}

    def backup(self, destination):
        target = Path(destination)
        if target.exists():
            raise ValueError("Backup destination already exists; choose a new file")
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        with self.lock:
            backup = sqlite3.connect(str(target))
            try:
                self.db.backup(backup)
                if backup.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                    raise RuntimeError("Backup failed integrity verification")
            finally:
                backup.close()
        os.chmod(target, 0o600)
