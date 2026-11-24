"""SQLite ledger for the paper simulator (data/paper.db). Every write that changes a position also writes
its trade event in the same transaction, so events cannot be lost or duplicated."""
from __future__ import annotations
import json, os, sqlite3, threading

DDL = """
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS checked (
  create_sig TEXT PRIMARY KEY, mint TEXT, create_time INTEGER, txs_first_5m INTEGER, eligible INTEGER, note TEXT, checked_at REAL, cycle_id INTEGER);
CREATE TABLE IF NOT EXISTS launches (
  mint TEXT PRIMARY KEY, create_sig TEXT, created_at INTEGER, discovered_at REAL, txs_first_5m INTEGER,
  status TEXT,                    -- scored | error | timeout
  as_of INTEGER, scored_at REAL, score_elapsed_s REAL, decision TEXT, score INTEGER, raw_points REAL, max_size_pct REAL,
  confidence TEXT, top_reasons TEXT, hard_flags TEXT, holder_count INTEGER, model_version TEXT, report_id TEXT,
  symbol TEXT, name TEXT, error TEXT,
  entry_status TEXT,              -- pending | priced | unfilled
  entry_at REAL, entry_price REAL, entry_mcap REAL, entry_liq REAL, entry_source TEXT, entry_pair TEXT,
  last_price REAL, last_price_at REAL, min_ret REAL, max_ret REAL, ret_24h REAL, dumped50 INTEGER, track_done INTEGER DEFAULT 0,
  price_attempts INTEGER DEFAULT 0, cycle_id INTEGER);
CREATE INDEX IF NOT EXISTS launches_entry ON launches(entry_status);
CREATE TABLE IF NOT EXISTS positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, book TEXT, mint TEXT, decision TEXT, score INTEGER,
  size_pct REAL, size_usd REAL, bankroll_at_entry REAL, entry_at REAL, entry_price REAL, entry_mcap REAL, entry_liq REAL,
  entry_cost REAL, tokens REAL, status TEXT,   -- open | closed
  last_price REAL, last_price_at REAL, last_mcap REAL, last_liq REAL, last_mark_at REAL, min_ret REAL, max_ret REAL,
  exit_at REAL, exit_price REAL, exit_fill_price REAL, exit_mcap REAL, exit_liq REAL, exit_cost REAL, exit_reason TEXT,
  proceeds_usd REAL, pnl_usd REAL, pnl_pct REAL, bankroll_after REAL,
  UNIQUE(book, mint));
CREATE INDEX IF NOT EXISTS positions_status ON positions(book, status);
CREATE TABLE IF NOT EXISTS misses (book TEXT, mint TEXT, decision TEXT, reason TEXT, size_usd REAL, cash_usd REAL, at REAL, PRIMARY KEY(book, mint));
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, created_at REAL, book TEXT, kind TEXT, position_id INTEGER, mint TEXT,
  payload TEXT, reported_at REAL, void_reason TEXT, seq INTEGER NOT NULL DEFAULT 0, UNIQUE(position_id, kind, seq));
CREATE TABLE IF NOT EXISTS cycles (id INTEGER PRIMARY KEY AUTOINCREMENT, started_at REAL, finished_at REAL, elapsed_s REAL, stats TEXT);
CREATE TABLE IF NOT EXISTS watchlist (book TEXT, mint TEXT, status TEXT, qualified_at REAL, trigger TEXT, qualify_price REAL,
    qualify_mcap REAL, high_price REAL, high_at REAL, low_price REAL, low_at REAL, last_price REAL, last_at REAL, polls INTEGER,
    expires_at REAL, decision TEXT, detail TEXT, entered_at REAL, entry_depth REAL, end_reason TEXT, PRIMARY KEY(book, mint));
-- 1-min marks of momentum-family mints (exit watcher + cycle fallback; DexScreener m5/h1 buys, sells, volume per mark)
CREATE TABLE IF NOT EXISTS marks (mint TEXT, at REAL, price REAL, liq REAL, buys_m5 REAL, sells_m5 REAL, vol_m5 REAL,
  buys_h1 REAL, sells_h1 REAL, vol_h1 REAL, chg_m5 REAL, dex TEXT, pair TEXT, source TEXT, by TEXT, PRIMARY KEY(mint, at));
CREATE TABLE IF NOT EXISTS equity (cycle_id INTEGER, book TEXT, at REAL, realized REAL, mtm REAL, open_count INTEGER, PRIMARY KEY(cycle_id, book));
-- whole-market scanner (smr/paper/scanner.py): its own observations, cached risk scores, every candidate + runner score, cycles
CREATE TABLE IF NOT EXISTS scanner_obs (mint TEXT, at REAL, price REAL, mcap REAL, liq REAL, vol_m5 REAL, vol_h1 REAL, buys_m5 REAL,
  sells_m5 REAL, buys_h1 REAL, sells_h1 REAL, buyers_m5 REAL, buyers_h1 REAL, holders INTEGER, PRIMARY KEY(mint, at));
CREATE TABLE IF NOT EXISTS scanner_scores (mint TEXT PRIMARY KEY, scored_at REAL, status TEXT, decision TEXT, score INTEGER,
  model_version TEXT, top_reasons TEXT, hard_flags TEXT, holder_count INTEGER, bundle_pct REAL, bundle_wallets INTEGER,
  cluster_pct REAL, create_sig TEXT, mayhem INTEGER, mayhem_source TEXT, elapsed_s REAL, error TEXT, source TEXT);
CREATE TABLE IF NOT EXISTS scanner_candidates (id INTEGER PRIMARY KEY AUTOINCREMENT, cycle_id INTEGER, at REAL, mint TEXT, symbol TEXT,
  sources TEXT, stage TEXT, reason TEXT, mcap REAL, liq REAL, age_h REAL, runner_score REAL, runner_detail TEXT, risk_decision TEXT,
  risk_score INTEGER, final_decision TEXT, mayhem INTEGER, position_id INTEGER, price REAL);
CREATE INDEX IF NOT EXISTS scanner_candidates_mint ON scanner_candidates(mint, at);
CREATE TABLE IF NOT EXISTS scanner_cycles (id INTEGER PRIMARY KEY AUTOINCREMENT, started_at REAL, finished_at REAL, elapsed_s REAL, stats TEXT);
"""


class Ledger:
    def __init__(self, path):
        d = os.path.dirname(path)
        if d:
            os.makedirs(d, exist_ok=True)
        self.path = path
        self.db = sqlite3.connect(path, timeout=60, check_same_thread=False, isolation_level=None)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA busy_timeout=60000")     # the 15-min cycle and the 1-min exit watcher share this file
        self.db.executescript(DDL)
        self._migrate()
        self.lock = threading.RLock()

    MIGRATIONS = {
        "launches": {"curve": "TEXT", "creator": "TEXT", "supply": "REAL", "asof_decision": "TEXT", "gate_cap": "TEXT",
                     "gate_reasons": "TEXT", "gate_liq": "REAL", "gate_holders": "INTEGER", "holder_source": "TEXT",
                     "entry_fdv": "REAL", "price_vs_launch": "REAL", "entry_note": "TEXT", "void_reason": "TEXT",
                     "strategy_status": "TEXT", "min_entry_mcap": "REAL", "first_priced_mcap": "REAL", "max_fdv_seen": "REAL",
                     "cross_at": "REAL", "mcap_at_cross": "REAL", "cross_decision": "TEXT", "cross_gate_reasons": "TEXT",
                     "cross_liq": "REAL", "cross_holders": "INTEGER", "circ_supply": "REAL",
                     # momentum book (smr.momentum / smr.narrative)
                     "momentum_status": "TEXT", "mom_score": "REAL", "narr_score": "REAL", "mom_combined": "REAL", "theme": "TEXT",
                     "mom_detail": "TEXT", "mom_checked_at": "REAL", "mom_checks": "INTEGER",
                     # pump.fun Mayhem mode (smr/mayhem.py): 1 / 0 / NULL unknown; entry gate for strategy + momentum
                     "mayhem": "INTEGER", "mayhem_source": "TEXT", "mayhem_checked_at": "REAL",
                     # bundle evidence from the as-of score (smr/paper/edge.py); bundle_block = gate reason for strategy + momentum
                     "bundle_pct": "REAL", "bundle_wallets": "INTEGER", "bundle_w2_pct": "REAL", "cluster_pct": "REAL",
                     "early_wallets": "TEXT", "bundle_block": "TEXT",
                     # smart money (strategy book only: strategy_decision = REDUCED lifted to NORMAL; smart_money = signal JSON)
                     "strategy_decision": "TEXT", "smart_money": "TEXT",
                     # live StalkChain holder count used by the strategy/momentum gate (JSON; benchmark decision unchanged)
                     "holders_live": "TEXT"},
        "positions": {"entry_trigger": "TEXT", "asof_decision": "TEXT", "gate_reasons": "TEXT", "entry_fdv": "REAL", "exit_fdv": "REAL", "void_reason": "TEXT",
                      # momentum book: selection detail + moon-bag partial exit (NULL for the other books)
                      "theme": "TEXT", "mom_score": "REAL", "narr_score": "REAL", "mom_combined": "REAL", "mom_detail": "TEXT",
                      "tokens_initial": "REAL", "partial_at": "REAL", "partial_price": "REAL", "partial_frac": "REAL", "partial_tokens": "REAL",
                      "partial_cost": "REAL", "partial_proceeds_usd": "REAL", "partial_pnl_usd": "REAL", "peak_price": "REAL", "moon_bag": "TEXT",
                      "mayhem": "INTEGER",
                      # edge signals at entry (strategy + momentum only; JSON)
                      "edge": "TEXT",
                      # rung exit policies (smr/paper/exits.py): NULL exit_policy = original moon-bag exit
                      "exit_policy": "TEXT", "clips_done": "INTEGER", "clip_log": "TEXT", "stop_price": "REAL",
                      "exit_trigger_price": "REAL", "grad_at_launch": "INTEGER", "grad_source": "TEXT", "mirror_of": "INTEGER",
                      # signal-driven control books (smr/paper/sigexit.py): permanent dust bag + signal state + next-mark order
                      "dust_frac": "REAL", "dust_tokens": "REAL", "dust_last_price": "REAL", "dust_last_at": "REAL", "dust_liq": "REAL",
                      "sig_state": "TEXT", "pending_sell": "TEXT",
                      # scanner book (smr/paper/scanner.py): transparent runner score at entry (logged for later evaluation)
                      "runner_score": "REAL",
                      # experiment100 fixed Solana fees (forward-only; null fee_model_version = legacy %-only)
                      "fee_model_version": "TEXT", "fee_schedule_json": "TEXT",
                      "fixed_fees_usd": "REAL", "entry_fixed_fee_usd": "REAL",
                      "rent_locked_usd": "REAL", "rent_recovered_usd": "REAL", "rent_forfeited_usd": "REAL"},
        "events": {"void_reason": "TEXT", "seq": "INTEGER NOT NULL DEFAULT 0"},
        "misses": {"void_reason": "TEXT"},
        "equity": {"void_reason": "TEXT"},
    }

    def _migrate(self):
        self._migrate_events_seq()
        for t, cols in self.MIGRATIONS.items():
            have = {r[1] for r in self.db.execute(f"PRAGMA table_info({t})")}
            for c, typ in cols.items():
                if c not in have:
                    self.db.execute(f"ALTER TABLE {t} ADD COLUMN {c} {typ}")

    def _migrate_events_seq(self):
        """2026-11-03 clip5: several PARTIAL_SELL events per position (one per clip). Old ledgers have
        UNIQUE(position_id, kind); rebuild the table once with UNIQUE(position_id, kind, seq), seq 0 for every old row.
        Ids, payloads and reported/void marks are copied unchanged, inside one transaction."""
        row = self.db.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='events'").fetchone()
        if not row or "UNIQUE(position_id, kind, seq)" in row[0]:
            return
        have = [r[1] for r in self.db.execute("PRAGMA table_info(events)")]
        cols = [c for c in ("id", "created_at", "book", "kind", "position_id", "mint", "payload", "reported_at", "void_reason") if c in have]
        self.db.execute("BEGIN IMMEDIATE")
        try:
            self.db.execute("""CREATE TABLE events_new (
              id INTEGER PRIMARY KEY AUTOINCREMENT, created_at REAL, book TEXT, kind TEXT, position_id INTEGER, mint TEXT,
              payload TEXT, reported_at REAL, void_reason TEXT, seq INTEGER NOT NULL DEFAULT 0, UNIQUE(position_id, kind, seq))""")
            self.db.execute(f"INSERT INTO events_new ({','.join(cols)}) SELECT {','.join(cols)} FROM events ORDER BY id")
            self.db.execute("DROP TABLE events")
            self.db.execute("ALTER TABLE events_new RENAME TO events")
            self.db.execute("COMMIT")
        except Exception:
            self.db.execute("ROLLBACK")
            raise

    # ---- helpers ---------------------------------------------------------------------------------------------
    def q(self, sql, args=()):
        with self.lock:
            return [dict(r) for r in self.db.execute(sql, args).fetchall()]

    def one(self, sql, args=()):
        r = self.q(sql, args)
        return r[0] if r else None

    def tx(self):
        return _Tx(self)

    def insert(self, table, row: dict, mode="INSERT"):
        cols = list(row)
        with self.lock:
            cur = self.db.execute(f"{mode} INTO {table} ({','.join(cols)}) VALUES ({','.join('?' * len(cols))})",
                                  [json.dumps(v) if isinstance(v, (dict, list)) else v for v in row.values()])
            return cur.lastrowid

    def update(self, table, key: dict, row: dict):
        sets = ",".join(f"{k}=?" for k in row)
        where = " AND ".join(f"{k}=?" for k in key)
        with self.lock:
            self.db.execute(f"UPDATE {table} SET {sets} WHERE {where}",
                            [json.dumps(v) if isinstance(v, (dict, list)) else v for v in row.values()] + list(key.values()))

    def close(self):
        self.db.close()


class _Tx:
    def __init__(self, led):
        self.led = led

    def __enter__(self):
        self.led.lock.acquire()
        self.led.db.execute("BEGIN IMMEDIATE")
        return self.led

    def __exit__(self, et, ev, tb):
        try:
            self.led.db.execute("ROLLBACK" if et else "COMMIT")
        finally:
            self.led.lock.release()
        return False
