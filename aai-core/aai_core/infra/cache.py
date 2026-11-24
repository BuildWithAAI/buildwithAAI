"""Extracted from smr/cache.py. Deterministic on-disk cache (SQLite).

Keys are sha256 over a canonical JSON of (namespace, method, params). Values are JSON.
TTL semantics: ttl=None -> immutable (cached forever, e.g. finalized transactions or signature
pages anchored with `before`); ttl=0 -> never cached; ttl>0 -> seconds.

Modes:
  readwrite  normal operation
  replay     read-only, ignores TTL, raises CacheMiss on a miss -> fully deterministic offline runs (tests)
  off        bypass
A `recorder` set can be attached to capture every key touched (used to export test fixtures).
"""
from __future__ import annotations
import gzip, hashlib, json, sqlite3, threading, time


class CacheMiss(Exception):
    pass


def make_key(*parts) -> str:
    return hashlib.sha256(json.dumps(parts, sort_keys=True, separators=(",", ":"), default=str).encode()).hexdigest()


class DiskCache:
    def __init__(self, path: str, mode: str = "readwrite"):
        assert mode in ("readwrite", "replay", "off"), mode
        self.path, self.mode = path, mode
        self._local = threading.local()
        self._lock = threading.Lock()
        self.recorder: dict | None = None
        self.stats = {"hits": 0, "misses": 0, "writes": 0}
        if mode != "off":
            c = self._conn()
            c.execute("CREATE TABLE IF NOT EXISTS cache (k TEXT PRIMARY KEY, v BLOB, ts REAL)")
            c.commit()

    def _conn(self) -> sqlite3.Connection:
        c = getattr(self._local, "c", None)
        if c is None:
            c = sqlite3.connect(self.path, timeout=60)
            c.execute("PRAGMA journal_mode=WAL")
            self._local.c = c
        return c

    def get(self, k: str, ttl: float | None):
        if self.mode == "off" or ttl == 0 and self.mode != "replay":
            return None
        row = self._conn().execute("SELECT v, ts FROM cache WHERE k=?", (k,)).fetchone()
        if not row:
            self.stats["misses"] += 1
            if self.mode == "replay":
                raise CacheMiss(k)
            return None
        if self.mode != "replay" and ttl is not None and time.time() - row[1] > ttl:
            self.stats["misses"] += 1
            return None
        self.stats["hits"] += 1
        v = json.loads(gzip.decompress(row[0]) if isinstance(row[0], bytes) else row[0])
        if self.recorder is not None:
            self.recorder[k] = v
        return v

    def set(self, k: str, v, ttl: float | None = None) -> None:
        if self.recorder is not None:
            self.recorder[k] = v
        if self.mode != "readwrite" or ttl == 0:
            return
        blob = gzip.compress(json.dumps(v, separators=(",", ":")).encode(), 5)
        with self._lock:
            c = self._conn()
            c.execute("INSERT OR REPLACE INTO cache VALUES (?,?,?)", (k, blob, time.time()))
            c.commit()
        self.stats["writes"] += 1

    def load_fixture(self, entries: dict) -> None:
        """Populate from an exported fixture ({key: value}); used to build replay caches for tests."""
        with self._lock:
            c = self._conn()
            c.execute("CREATE TABLE IF NOT EXISTS cache (k TEXT PRIMARY KEY, v BLOB, ts REAL)")
            c.executemany("INSERT OR REPLACE INTO cache VALUES (?,?,?)",
                          [(k, gzip.compress(json.dumps(v, separators=(",", ":")).encode(), 5), 0.0) for k, v in entries.items()])
            c.commit()
