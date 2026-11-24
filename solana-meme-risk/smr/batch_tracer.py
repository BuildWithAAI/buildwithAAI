"""Stage 2 - anchored backward funding search (1-2 hops), persisted to SQLite (funding_graph.db).

For every wallet we search BACKWARDS FROM AN ANCHOR SIGNATURE (the wallet's buy tx; for hop 2 the funding tx):
  getSignaturesForAddress(wallet, before=anchor) for up to `trace_sig_pages` x 1000 signatures.
  * If the wallet's first-ever transaction is reached -> wallet age at the anchor is exact and its oldest
    transactions (normally the initial funding) are parsed.
  * The most recent transactions inside the funding window before the anchor are parsed as well
    (catches top-ups right before a bundle buy).
Anchoring (instead of probing the newest signatures, as v0 did) means activity AFTER the buy - typical for
bots that keep trading - no longer hides the funding, and it makes the trace point-in-time (no lookahead).
Incoming SOL = system transfer / createAccount(+WithSeed), incl. inner instructions. Funders that are
labeled CEX/service wallets are recorded but never expanded or used to link wallets.
"""
from __future__ import annotations
import sqlite3, threading, time
from concurrent.futures import ThreadPoolExecutor
from . import chain, logging_setup as L
from .sources.rpc import RpcError

log = L.get("trace")

SCHEMA = """
CREATE TABLE IF NOT EXISTS wallet_probes (
  wallet TEXT, anchor_sig TEXT, anchor_time INTEGER, first_block_time INTEGER, first_signature TEXT,
  sigs_scanned INTEGER, history_complete INTEGER, is_hub INTEGER, label TEXT, probed_at REAL,
  PRIMARY KEY (wallet, anchor_sig));
CREATE TABLE IF NOT EXISTS edges (
  funder TEXT, funded TEXT, lamports INTEGER, slot INTEGER, block_time INTEGER, signature TEXT,
  PRIMARY KEY (signature, funder, funded));
CREATE INDEX IF NOT EXISTS edges_funded ON edges(funded);
CREATE INDEX IF NOT EXISTS edges_funder ON edges(funder);
CREATE TABLE IF NOT EXISTS tx_fanout (signature TEXT PRIMARY KEY, n_recipients INTEGER);
CREATE TABLE IF NOT EXISTS trace_runs (
  mint TEXT, wallet TEXT, role TEXT, hop INTEGER, parent TEXT, created_at REAL,
  PRIMARY KEY (mint, wallet, role, hop));
"""
PROBE_COLS = ["wallet", "anchor_sig", "anchor_time", "first_block_time", "first_signature", "sigs_scanned",
              "history_complete", "is_hub", "label", "probed_at"]


class GraphDB:
    def __init__(self, path):
        self.path = path
        self.db = sqlite3.connect(path, timeout=60, check_same_thread=False)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.executescript(SCHEMA)
        self.lock = threading.RLock()

    def probe_row(self, wallet, anchor_sig):
        with self.lock:
            r = self.db.execute(f"SELECT {','.join(PROBE_COLS)} FROM wallet_probes WHERE wallet=? AND anchor_sig=?", (wallet, anchor_sig)).fetchone()
        return dict(zip(PROBE_COLS, r)) if r else None

    def save_probe(self, row, edges, fanout):
        with self.lock:
            self.db.executemany("INSERT OR IGNORE INTO edges VALUES (?,?,?,?,?,?)", edges)
            self.db.executemany("INSERT OR REPLACE INTO tx_fanout VALUES (?,?)", fanout)
            self.db.execute(f"INSERT OR REPLACE INTO wallet_probes VALUES ({','.join('?' * len(PROBE_COLS))})", [row[c] for c in PROBE_COLS])
            self.db.commit()

    def funders_of(self, wallet, anchor_time, window_s, k):
        """First-ever funder (earliest edge) + largest funders inside the window, all strictly before anchor_time."""
        with self.lock:
            rows = self.db.execute(
                "SELECT e.funder, SUM(e.lamports), MIN(e.block_time), MIN(e.slot), MIN(e.signature), MAX(COALESCE(f.n_recipients,1)) "
                "FROM edges e LEFT JOIN tx_fanout f ON f.signature=e.signature WHERE e.funded=? AND (e.block_time IS NULL OR e.block_time<=?) "
                "GROUP BY e.funder", (wallet, anchor_time)).fetchall()
        fs = [{"funder": r[0], "lamports": r[1], "first_block_time": r[2], "first_slot": r[3], "signature": r[4], "max_fanout": r[5],
               "in_window": r[2] is None or r[2] >= anchor_time - window_s} for r in rows]
        if not fs:
            return []
        earliest = min(fs, key=lambda f: (f["first_slot"] or 0))
        rest = sorted([f for f in fs if f is not earliest and f["in_window"]], key=lambda f: -f["lamports"])
        return [earliest] + rest[: k - 1]

    def proven_deep_hub(self, wallet, anchor_time, min_sigs):
        """True if an EARLIER-anchored probe of this unlabeled wallet already walked >= min_sigs signatures without
        reaching its first tx. History only grows, so a later anchor is also a deep hub (point-in-time safe)."""
        if anchor_time is None:
            return False
        with self.lock:
            r = self.db.execute("SELECT 1 FROM wallet_probes WHERE wallet=? AND history_complete=0 AND label IS NULL "
                                "AND sigs_scanned>=? AND anchor_time IS NOT NULL AND anchor_time<? LIMIT 1",
                                (wallet, min_sigs, anchor_time)).fetchone()
        return bool(r)

    def record_run(self, mint, wallet, role, hop, parent=None):
        with self.lock:
            self.db.execute("INSERT OR REPLACE INTO trace_runs VALUES (?,?,?,?,?,?)", (mint, wallet, role, hop, parent, time.time()))

    def commit(self):
        with self.lock:
            self.db.commit()

    def counts(self):
        with self.lock:
            return {t: self.db.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in ("wallet_probes", "edges", "tx_fanout", "trace_runs")}


class BatchTracer:
    def __init__(self, ctx):
        self.ctx, self.s = ctx, ctx.settings
        self.g = ctx.graph
        self.warnings = []
        self.stats = {"probes": 0, "probe_cache_hits": 0, "complete_histories": 0, "hubs": 0, "labeled": 0}

    def probe(self, wallet, anchor_sig, anchor_time):
        lab = self.ctx.labels.get(wallet)
        row = self.g.probe_row(wallet, anchor_sig)
        if row:
            self.stats["probe_cache_hits"] += 1
            return row
        self.stats["probes"] += 1
        base = {"wallet": wallet, "anchor_sig": anchor_sig, "anchor_time": anchor_time, "first_block_time": None, "first_signature": None,
                "sigs_scanned": 0, "history_complete": 0, "is_hub": 1 if lab else 0, "label": lab.name if lab else None, "probed_at": time.time()}
        if lab:
            self.stats["labeled"] += 1
            self.g.save_probe(base, [], []); return base
        sigs, before, complete = [], anchor_sig, False
        full_scan = self.s.trace_sig_pages * 1000
        window_lo = anchor_time - self.s.funding_window_hours * 3600 if anchor_time else None
        deep_hub = self.g.proven_deep_hub(wallet, anchor_time, full_scan)
        skipped_pages = False
        try:
            for i in range(self.s.trace_sig_pages):
                page = self.ctx.rpc.get_signatures(wallet, 1000, before=before)
                sigs.extend(page)
                if len(page) < 1000:
                    complete = True; break
                before = page[-1]["signature"]
                if deep_hub and i + 1 < self.s.trace_sig_pages and self._window_covered(sigs, window_lo):
                    # remaining pages cannot change the result: still incomplete + hub, and the recent-window
                    # txs we fetch are already in hand. Saves 1000-sig getSignatures pages on repeat hubs.
                    skipped_pages = True; break
        except RpcError as e:
            # anchor signature unknown to every endpoint: fall back to newest-first paging filtered by time
            # (still no lookahead; deep post-anchor activity may hide the funding -> counted as hub)
            self.stats["anchor_fallbacks"] = self.stats.get("anchor_fallbacks", 0) + 1
            sigs, before, complete = [], None, False
            try:
                for _ in range(self.s.trace_sig_pages):
                    page = self.ctx.rpc.get_signatures(wallet, 1000, before=before)
                    sigs.extend(page)
                    if len(page) < 1000:
                        complete = True; break
                    before = page[-1]["signature"]
            except RpcError as e2:
                self.warnings.append(f"sigs {wallet[:8]}: {e2}"); return None
            sigs = [x for x in sigs if anchor_time is None or (x.get("blockTime") or 0) < anchor_time]
        ok = [x for x in sigs if x.get("err") is None]
        to_fetch = []
        if complete and ok:
            to_fetch += [x["signature"] for x in ok[-self.s.trace_oldest_k:]]
        recent = [x for x in ok if window_lo is None or (x.get("blockTime") or 0) >= window_lo]
        to_fetch += [x["signature"] for x in recent[: self.s.trace_recent_k]]
        edges, fanout = [], []
        bt_of = {x["signature"]: x.get("blockTime") for x in ok}
        for sig, tx, err in self._fetch_txs(list(dict.fromkeys(to_fetch)), bt_of):
            if err is not None:
                self.warnings.append(f"tx {sig[:10]}: {err}"); continue
            if not tx or not tx.get("meta"):
                continue
            inc = [(src, lam) for src, lam in chain.incoming_sol(tx, wallet) if lam >= self.s.min_transfer_sol * 1e9]
            if inc:
                fanout.append((sig, len(chain.system_transfer_recipients(tx))))
            edges += [(src, wallet, lam, tx["slot"], tx.get("blockTime"), sig) for src, lam in inc]
        oldest = sigs[-1] if sigs else None
        base.update(first_block_time=oldest.get("blockTime") if (oldest and complete) else None,
                    first_signature=oldest["signature"] if (oldest and complete) else None,
                    sigs_scanned=full_scan if skipped_pages else len(sigs), history_complete=int(complete),
                    is_hub=int((not complete) or len(sigs) >= self.s.hub_sig_threshold))
        self.stats["complete_histories"] += int(complete); self.stats["hubs"] += base["is_hub"]
        if skipped_pages:
            self.stats["hub_page_skips"] = self.stats.get("hub_page_skips", 0) + 1
        self.g.save_probe(base, edges, fanout)
        return base

    def _fetch_txs(self, sigs, bt_of):
        """Fetch txs with up to trace_tx_concurrency calls in flight; yields (sig, tx, err) in input order, so edges,
        fanout and warnings are identical to serial fetching. Free mainnet-beta takes ~5-7 s per historical tx, so
        serial fetching left most of its rate budget unused; the endpoint token bucket still caps the global rate."""
        def one(sig):
            try:
                return sig, self.ctx.rpc.get_transaction(sig, block_time=bt_of.get(sig)), None
            except RpcError as e:
                return sig, None, e
        n = max(1, int(getattr(self.s, "trace_tx_concurrency", 1) or 1))
        if n == 1 or len(sigs) <= 1:
            return [one(s) for s in sigs]
        with ThreadPoolExecutor(min(n, len(sigs))) as ex:
            return list(ex.map(one, sigs))

    def _window_covered(self, sigs, window_lo):
        """True if signatures already fetched decide recent[:trace_recent_k]: either enough ok in-window sigs, or the
        oldest fetched sig is already before the funding window (older pages hold nothing in-window)."""
        if window_lo is None or not sigs:
            return False
        n_recent = sum(1 for x in sigs if x.get("err") is None and (x.get("blockTime") or 0) >= window_lo)
        return n_recent >= self.s.trace_recent_k or (sigs[-1].get("blockTime") or 0) < window_lo

    def _funders(self, wallet, anchor_time):
        out = []
        for f in self.g.funders_of(wallet, anchor_time or 2**40, self.s.funding_window_hours * 3600, self.s.trace_funders_per_wallet):
            lab = self.ctx.labels.get(f["funder"])
            f["label"] = f"{lab.name} ({lab.category})" if lab else None
            f["non_linking"] = bool(lab)
            out.append(f)
        return out

    def trace(self, mint, wallets, hops=None):
        """wallets: list of dicts {wallet, role, anchor_sig, anchor_time}. Returns {wallet: {role, info, funders[...hop2]}}."""
        hops = hops or self.s.trace_hops
        out = {}
        with ThreadPoolExecutor(self.s.workers) as ex:
            infos = list(ex.map(lambda w: self.probe(w["wallet"], w["anchor_sig"], w["anchor_time"]), wallets))
        hop2 = {}
        for w, info in zip(wallets, infos):
            self.g.record_run(mint, w["wallet"], w["role"], 0)
            fs = self._funders(w["wallet"], w["anchor_time"])
            out[w["wallet"]] = {"role": w["role"], "info": info, "funders": fs}
            for f in fs:
                if not f["non_linking"] and f.get("signature"):
                    hop2.setdefault((f["funder"], f["signature"], f["first_block_time"]), set()).add(w["wallet"])
        if hops >= 2 and hop2:
            keys = list(hop2)
            with ThreadPoolExecutor(self.s.workers) as ex:
                h_infos = dict(zip(keys, ex.map(lambda k: self.probe(k[0], k[1], k[2]), keys)))
            for k, children in hop2.items():
                self.g.record_run(mint, k[0], "funder", 1, ",".join(sorted(children))[:500])
            for w, d in out.items():
                for f in d["funders"]:
                    key = (f["funder"], f.get("signature"), f["first_block_time"])
                    inf = h_infos.get(key)
                    f["funder_is_hub"] = bool(inf and inf.get("is_hub"))
                    f["funder_history_complete"] = bool(inf and inf.get("history_complete"))
                    f["funder_first_block_time"] = inf.get("first_block_time") if inf else None
                    f["hop2"] = [] if (not inf or inf.get("is_hub") and inf.get("label")) else self._funders(f["funder"], f["first_block_time"])
        self.g.commit()
        return out
