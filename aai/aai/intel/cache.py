"""SQLite cache for intel feeds. intel_snapshots is append-only in normal operation (one row per fetch attempt,
with fetched_at, source, ok, latency and either a JSON payload or an error). Old rows are pruned by retention only."""
from __future__ import annotations
import json, time

SCHEMA = """
CREATE TABLE IF NOT EXISTS intel_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT, feed TEXT NOT NULL, source TEXT NOT NULL, fetched_at REAL NOT NULL,
  ok INTEGER NOT NULL, latency_ms INTEGER, payload TEXT, error TEXT);
CREATE INDEX IF NOT EXISTS ix_intel_snap ON intel_snapshots(feed, ok, fetched_at);
CREATE TABLE IF NOT EXISTS intel_state (
  feed TEXT PRIMARY KEY, last_ok_at REAL, last_attempt_at REAL, consecutive_fails INTEGER NOT NULL DEFAULT 0,
  breaker_open_until REAL, last_error TEXT, last_latency_ms INTEGER, n_ok INTEGER NOT NULL DEFAULT 0, n_fail INTEGER NOT NULL DEFAULT 0);
"""
RETAIN_OK_DAYS = 7
RETAIN_FAIL_DAYS = 2
KEEP_MIN = 30


class IntelCache:
    def __init__(self, store):
        self.store = store
        store.conn.executescript(SCHEMA)
        self._latest: dict[str, tuple[int, dict]] = {}   # feed -> (snapshot id, decoded row) to avoid re-parsing JSON

    def record(self, feed: str, source: str, ok: bool, payload: dict | None = None, error: str | None = None,
               latency_ms: int | None = None, breaker_until: float | None = None, ts: float | None = None) -> int:
        ts = ts or time.time()
        cur = self.store.execute("INSERT INTO intel_snapshots(feed,source,fetched_at,ok,latency_ms,payload,error) VALUES(?,?,?,?,?,?,?)",
                                 (feed, source, ts, 1 if ok else 0, latency_ms,
                                  json.dumps(payload, separators=(",", ":"), default=str) if ok else None, None if ok else (error or "")[:300]))
        self.store.execute("""INSERT INTO intel_state(feed,last_ok_at,last_attempt_at,consecutive_fails,breaker_open_until,last_error,last_latency_ms,n_ok,n_fail)
            VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(feed) DO UPDATE SET
            last_ok_at=COALESCE(excluded.last_ok_at, intel_state.last_ok_at), last_attempt_at=excluded.last_attempt_at,
            consecutive_fails=CASE WHEN excluded.consecutive_fails=0 THEN 0 ELSE intel_state.consecutive_fails+1 END,
            breaker_open_until=excluded.breaker_open_until, last_error=COALESCE(excluded.last_error, intel_state.last_error),
            last_latency_ms=excluded.last_latency_ms, n_ok=intel_state.n_ok+excluded.n_ok, n_fail=intel_state.n_fail+excluded.n_fail""",
                           (feed, ts if ok else None, ts, 0 if ok else 1, breaker_until, None if ok else (error or "")[:300], latency_ms,
                            1 if ok else 0, 0 if ok else 1))
        if ok:
            self.store.execute("UPDATE intel_state SET last_error=NULL WHERE feed=?", (feed,))
        return cur.lastrowid

    def set_breaker(self, feed: str, until: float | None):
        self.store.execute("UPDATE intel_state SET breaker_open_until=? WHERE feed=?", (until, feed))

    def state(self, feed: str) -> dict:
        return self.store.one("SELECT * FROM intel_state WHERE feed=?", (feed,)) or {
            "feed": feed, "last_ok_at": None, "last_attempt_at": None, "consecutive_fails": 0, "breaker_open_until": None,
            "last_error": None, "last_latency_ms": None, "n_ok": 0, "n_fail": 0}

    def latest_ok(self, feed: str) -> dict | None:
        head = self.store.one("SELECT id FROM intel_snapshots WHERE feed=? AND ok=1 ORDER BY fetched_at DESC, id DESC LIMIT 1", (feed,))
        if not head:
            return None
        hit = self._latest.get(feed)
        if hit and hit[0] == head["id"]:
            return hit[1]
        r = self.store.one("SELECT id,feed,source,fetched_at,latency_ms,payload FROM intel_snapshots WHERE id=?", (head["id"],))
        r["payload"] = json.loads(r["payload"])
        self._latest[feed] = (r["id"], r)
        return r

    def previous_ok(self, feed: str) -> dict | None:
        """Second-newest successful snapshot (decoded payload), or None. Same shape as latest_ok."""
        rows = self.store.query(
            "SELECT id,feed,source,fetched_at,latency_ms,payload FROM intel_snapshots WHERE feed=? AND ok=1 ORDER BY fetched_at DESC, id DESC LIMIT 2",
            (feed,))
        if len(rows) < 2:
            return None
        r = dict(rows[1])
        r["payload"] = json.loads(r["payload"])
        return r

    def history(self, feed: str, n: int = 20) -> list[dict]:
        return self.store.query("SELECT id,fetched_at,ok,latency_ms,error FROM intel_snapshots WHERE feed=? ORDER BY fetched_at DESC, id DESC LIMIT ?",
                                (feed, n))

    def prune(self, now: float | None = None) -> int:
        now = now or time.time()
        n = 0
        for feed in [r["feed"] for r in self.store.query("SELECT DISTINCT feed FROM intel_snapshots")]:
            keep = self.store.one("SELECT fetched_at FROM intel_snapshots WHERE feed=? AND ok=1 ORDER BY fetched_at DESC LIMIT 1 OFFSET ?",
                                  (feed, KEEP_MIN - 1))
            floor = min(now - RETAIN_OK_DAYS * 86400, keep["fetched_at"] if keep else 0)
            n += self.store.execute("DELETE FROM intel_snapshots WHERE feed=? AND ok=1 AND fetched_at<?", (feed, floor)).rowcount
            n += self.store.execute("DELETE FROM intel_snapshots WHERE feed=? AND ok=0 AND fetched_at<?",
                                    (feed, now - RETAIN_FAIL_DAYS * 86400)).rowcount
        return n
