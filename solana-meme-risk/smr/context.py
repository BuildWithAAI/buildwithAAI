"""Execution context: wires settings, cache, sources, labels, graph DB and the time anchor index.
Everything downstream receives a Context (no globals), so tests can inject replay caches / fakes and
phase-2 agents can share one process-wide context."""
from __future__ import annotations
import sqlite3, threading, time
from . import config as C, logging_setup as L
from .cache import DiskCache
from .labels import Labels
from .sources.rpc import RpcPool
from .sources.http import PumpFunApi, DexScreenerApi, GeckoTerminalApi

log = L.get("context")


class AnchorIndex:
    """Maps a unix time to a finalized signature at/just before that time, using the pump.fun mint-authority
    stream (TSLvdd..., ~36 creates/min). Passing that signature as `before` to getSignaturesForAddress on ANY
    address returns only history strictly before it -> point-in-time (no-lookahead) queries."""
    def __init__(self, path, rpc):
        self.rpc = rpc
        self.db = sqlite3.connect(path, timeout=60, check_same_thread=False)
        self.db.execute("CREATE TABLE IF NOT EXISTS stream (signature TEXT PRIMARY KEY, slot INTEGER, block_time INTEGER, err INTEGER)")
        self.db.execute("CREATE INDEX IF NOT EXISTS stream_bt ON stream(block_time)")
        self.db.commit()
        self.lock = threading.Lock()
        self.fill_lock = threading.Lock()

    GAP_S = 300   # the stream carries ~30+ creates/min; a >5 min hole means un-indexed history

    def _page_back(self, before, stop_ts, max_pages, ttl="auto"):
        n = 0
        while n < max_pages:
            page = self.rpc.get_signatures(C.PUMP_MINT_AUTHORITY, 1000, before=before, ttl=0 if before is None else ttl)
            n += 1
            if not page:
                break
            self.add_page(page)
            last = page[-1].get("blockTime") or 0
            if last <= stop_ts:
                break
            before = page[-1]["signature"]
        return n

    def ensure_range(self, lo: int, hi: int, max_pages: int = 300) -> dict:
        """Make the stream index contiguous over [lo, hi] (fills head, interior gaps and tail).
        Returns coverage info. Thread-safe; normally a no-op or 1 head page."""
        with self.fill_lock:
            used = 0
            with self.lock:
                newest = self.db.execute("SELECT MAX(block_time) FROM stream").fetchone()[0]
            if newest is None or newest < hi - 30:
                used += self._page_back(None, newest if newest else lo, max_pages)
            for _ in range(50):
                with self.lock:
                    rows = self.db.execute("SELECT signature, block_time FROM stream WHERE block_time BETWEEN ? AND ? ORDER BY block_time",
                                           (lo - self.GAP_S, hi + self.GAP_S)).fetchall()
                gap = None
                for (s1, t1), (s2, t2) in zip(rows, rows[1:]):
                    if t2 - t1 > self.GAP_S:
                        gap = (s2, t1); break
                if gap is None and rows and rows[0][1] > lo:
                    gap = (rows[0][0], lo)
                if gap is None or used >= max_pages:
                    break
                k = self._page_back(gap[0], gap[1], max_pages - used)
                used += k
                if k == 0:
                    break
            with self.lock:
                cmin, cmax, cnt = self.db.execute("SELECT MIN(block_time), MAX(block_time), COUNT(*) FROM stream WHERE block_time BETWEEN ? AND ?", (lo, hi)).fetchone()
            return {"pages_fetched": used, "covered_from": cmin, "covered_to": cmax, "creates_indexed": cnt,
                    "complete": bool(cmin and cmin - lo <= self.GAP_S and hi - cmax <= self.GAP_S + 60)}

    def sigs_in(self, signatures) -> set:
        sigs = list(signatures)
        out = set()
        with self.lock:
            for i in range(0, len(sigs), 500):
                chunk = sigs[i:i + 500]
                out |= {r[0] for r in self.db.execute(f"SELECT signature FROM stream WHERE signature IN ({','.join('?' * len(chunk))})", chunk)}
        return out

    def add_page(self, page):
        with self.lock:
            self.db.executemany("INSERT OR IGNORE INTO stream VALUES (?,?,?,?)",
                                [(s["signature"], s["slot"], s.get("blockTime"), int(s.get("err") is not None)) for s in page if s.get("blockTime")])
            self.db.commit()

    def anchor_at(self, ts: int, tolerance_s: int = 90, max_pages: int = 400) -> dict | None:
        with self.lock:
            row = self.db.execute("SELECT signature, slot, block_time FROM stream WHERE block_time<=? AND block_time>=? ORDER BY block_time DESC, slot DESC LIMIT 1",
                                  (ts, ts - tolerance_s)).fetchone()
        if row:
            return {"signature": row[0], "slot": row[1], "block_time": row[2]}
        with self.lock:
            newer = self.db.execute("SELECT signature, block_time FROM stream WHERE block_time>? ORDER BY block_time ASC LIMIT 1", (ts,)).fetchone()
        before = newer[0] if newer else None
        for _ in range(max_pages):
            page = self.rpc.get_signatures(C.PUMP_MINT_AUTHORITY, 1000, before=before)
            if not page:
                break
            self.add_page(page)
            if page[-1].get("blockTime") and page[-1]["blockTime"] <= ts:
                return self.anchor_at(ts, tolerance_s, 0)
            before = page[-1]["signature"]
        return None


class Context:
    def __init__(self, settings: C.Settings | None = None, cache_mode: str | None = None):
        self.settings = s = settings or C.load_settings()
        L.setup()
        self.cache = DiskCache(s.cache_db, cache_mode or s.cache_mode)
        self.rpc = RpcPool(s.endpoints, self.cache)
        self.pumpfun = PumpFunApi(s, self.cache)
        self.dex = DexScreenerApi(s, self.cache)
        self.gt = GeckoTerminalApi(s, self.cache)
        self.labels = Labels(s.labels_file)
        self.anchors = AnchorIndex(f"{s.data_dir}/launches.db", self.rpc)
        self._graph = None
        self.clock = time.time

    @property
    def graph(self):
        if self._graph is None:
            from .batch_tracer import GraphDB
            self._graph = GraphDB(self.settings.graph_db)
        return self._graph

    def source_snapshot(self) -> dict:
        return {"rpc": self.rpc.snapshot(), "pumpfun": self.pumpfun.h.snapshot(), "dexscreener": self.dex.h.snapshot(),
                "geckoterminal": self.gt.h.snapshot(), "cache": dict(self.cache.stats)}


_default = None
_lock = threading.Lock()


def default_context() -> Context:
    global _default
    with _lock:
        if _default is None:
            _default = Context()
        return _default
