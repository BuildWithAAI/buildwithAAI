"""Single-operator, persistent watches, observation history, and bot offsets."""
import json
import os
import sqlite3
import stat
import tempfile
import threading
import time
from pathlib import Path
from .evidence import now
from .mint import decode_address


SCHEMA = {"watches": ("mint", "created_at"), "observations": ("id", "mint", "available_at", "report"),
          "state": ("key", "value")}


def check_schema(db):
    if db.execute("PRAGMA user_version").fetchone()[0] != 1:
        raise ValueError("Unsupported scanner database schema")
    for table, columns in SCHEMA.items():
        actual = tuple(row[1] for row in db.execute(f"PRAGMA table_info({table})"))
        kind = db.execute("SELECT type FROM sqlite_master WHERE name=?", (table,)).fetchone()
        if actual != columns or not kind or kind[0] != "table":
            raise ValueError("Scanner database schema is invalid")


def backup_connection(path):
    """Read a standalone snapshot without initializing, migrating or writing to it."""
    target = Path(path)
    if not stat.S_ISREG(target.lstat().st_mode):
        raise ValueError("Backup must be a regular file, not a symlink")
    if any(os.path.lexists(str(target) + suffix) for suffix in ("-wal", "-shm", "-journal")):
        raise ValueError("Use a standalone backup without SQLite sidecars")
    return sqlite3.connect(target.resolve().as_uri() + "?mode=ro&immutable=1", uri=True)


def verify_backup(path):
    db = backup_connection(path)
    try:
        check_schema(db)
        if db.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
            raise ValueError("Backup integrity verification failed")
        return {"status": "PASSED", "schema_version": 1,
                "watches": db.execute("SELECT count(*) FROM watches").fetchone()[0],
                "observations": db.execute("SELECT count(*) FROM observations").fetchone()[0]}
    finally:
        db.close()


def snapshot(db, destination):
    """Publish a verified private snapshot atomically; never replace any existing path."""
    target = Path(destination)
    if os.path.lexists(target) or any(os.path.lexists(str(target) + suffix) for suffix in ("-wal", "-shm", "-journal")):
        raise ValueError("Destination or SQLite sidecar already exists; choose a new file")
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temporary = tempfile.mkstemp(prefix=".scanner-backup-", suffix=".sqlite3", dir=target.parent)
    os.close(fd)
    try:
        copy = sqlite3.connect(temporary)
        try:
            deadline = time.monotonic() + 30
            def progress(status, remaining, total):
                if time.monotonic() > deadline:
                    raise RuntimeError("Backup exceeded the operation budget")
            db.backup(copy, pages=256, progress=progress)
            copy.execute("PRAGMA journal_mode=DELETE")
        finally:
            copy.close()
        result = verify_backup(temporary)
        with open(temporary, "rb") as handle:
            os.fsync(handle.fileno())
        # Hard-link publication is atomic and exclusive, including dangling symlinks.
        # Unsupported filesystems fail closed; no fallback overwrites a destination.
        os.link(temporary, target)
        if os.name == "posix":
            directory = os.open(target.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
        return result
    finally:
        for suffix in ("", "-wal", "-shm", "-journal"):
            Path(temporary + suffix).unlink(missing_ok=True)


def restore_backup(source, destination):
    """Restore into a NEW file. Never touch the configured live database."""
    verify_backup(source)
    db = backup_connection(source)
    try:
        return snapshot(db, destination)
    finally:
        db.close()


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
        if version == 1:
            try:
                check_schema(self.db)
            except ValueError:
                self.db.close()
                raise
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

    def probe(self, integrity=False):
        """Check schema/read/write access, rolling back the probe rather than changing state."""
        with self.lock:
            check_schema(self.db)
            if integrity and self.db.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
                raise ValueError("Database integrity verification failed")
            self.db.execute("SAVEPOINT readiness")
            try:
                self.db.execute("INSERT OR REPLACE INTO state VALUES(?,?)", ("readiness_probe", "probe"))
                counts = self.counts()
            finally:
                self.db.execute("ROLLBACK TO readiness")
                self.db.execute("RELEASE readiness")
            return {"status": "AVAILABLE", "schema_version": 1, "counts": counts,
                    "integrity": "PASSED" if integrity else "UNVERIFIED"}

    def backup(self, destination):
        with self.lock:
            return snapshot(self.db, destination)
