"""Single SQLite store (WAL) with normalized schemas for market data, signals, ideas, OMS and audit."""
from __future__ import annotations
import json, sqlite3, threading, time
from pathlib import Path

SCHEMA_VERSION = 3   # v3: lt_account_policies (OnePay Roth user-executed, audit-only)
SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

-- normalized market data ---------------------------------------------------
CREATE TABLE IF NOT EXISTS instruments (
  venue TEXT NOT NULL, symbol TEXT NOT NULL, sector TEXT NOT NULL, inst_type TEXT,
  base TEXT, quote TEXT, contract_value REAL, lot_size REAL, min_size REAL, tick_size REAL,
  max_leverage REAL, state TEXT, raw TEXT, updated_at REAL NOT NULL,
  PRIMARY KEY (venue, symbol));
CREATE TABLE IF NOT EXISTS quotes (
  venue TEXT NOT NULL, symbol TEXT NOT NULL, ts REAL NOT NULL, last REAL, bid REAL, ask REAL,
  mark REAL, index_px REAL, vol24h REAL, source TEXT NOT NULL, fetched_at REAL NOT NULL);
CREATE INDEX IF NOT EXISTS ix_quotes ON quotes(venue, symbol, ts);
CREATE TABLE IF NOT EXISTS candles (
  venue TEXT NOT NULL, symbol TEXT NOT NULL, tf TEXT NOT NULL, ts REAL NOT NULL,
  o REAL, h REAL, l REAL, c REAL, v REAL, source TEXT NOT NULL,
  PRIMARY KEY (venue, symbol, tf, ts));
CREATE TABLE IF NOT EXISTS funding (
  venue TEXT NOT NULL, symbol TEXT NOT NULL, ts REAL NOT NULL, rate REAL, next_funding_ts REAL,
  interval_h REAL, source TEXT NOT NULL, PRIMARY KEY (venue, symbol, ts));

-- on-chain / research signals ---------------------------------------------
CREATE TABLE IF NOT EXISTS signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts REAL NOT NULL, sector TEXT NOT NULL, source TEXT NOT NULL,
  symbol TEXT NOT NULL, kind TEXT NOT NULL, score REAL, recommendation TEXT, payload TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_signals ON signals(sector, symbol, ts);

-- ideas -> risk decisions -> orders -> fills -> positions ----------------
CREATE TABLE IF NOT EXISTS ideas (
  id TEXT PRIMARY KEY, ts REAL NOT NULL, sector TEXT NOT NULL, source TEXT NOT NULL, venue TEXT,
  symbol TEXT NOT NULL, side TEXT NOT NULL, entry REAL, stop REAL, target REAL,
  requested_risk REAL, signal_id INTEGER, rationale TEXT, payload TEXT,
  status TEXT NOT NULL DEFAULT 'new');
CREATE TABLE IF NOT EXISTS risk_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts REAL NOT NULL, idea_id TEXT NOT NULL, approved INTEGER NOT NULL,
  risk_frac REAL, risk_usd REAL, qty REAL, notional REAL, checks TEXT NOT NULL, inputs TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY, ts REAL NOT NULL, idea_id TEXT NOT NULL, symbol TEXT NOT NULL, venue TEXT,
  side TEXT NOT NULL, qty REAL NOT NULL, order_type TEXT NOT NULL, limit_px REAL, status TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'paper');
CREATE TABLE IF NOT EXISTS fills (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts REAL NOT NULL, order_id TEXT NOT NULL, px REAL NOT NULL,
  qty REAL NOT NULL, fee REAL NOT NULL, slippage_bps REAL NOT NULL);
CREATE TABLE IF NOT EXISTS positions (
  id TEXT PRIMARY KEY, idea_id TEXT NOT NULL, sector TEXT NOT NULL, venue TEXT, symbol TEXT NOT NULL,
  side TEXT NOT NULL, qty REAL NOT NULL, entry_px REAL NOT NULL, stop REAL, target REAL,
  risk_usd REAL NOT NULL, opened_at REAL NOT NULL, closed_at REAL, exit_px REAL, realized_pnl REAL,
  fees REAL NOT NULL DEFAULT 0, last_px REAL, status TEXT NOT NULL, close_reason TEXT);
CREATE TABLE IF NOT EXISTS equity_snapshots (
  ts REAL NOT NULL, equity REAL NOT NULL, cash_pnl REAL NOT NULL, unrealized REAL NOT NULL, open_risk REAL NOT NULL);

-- control + audit ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS control (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at REAL NOT NULL);
CREATE TABLE IF NOT EXISTS audit_log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, ts REAL NOT NULL, actor TEXT NOT NULL, event TEXT NOT NULL,
  ref TEXT, inputs TEXT NOT NULL, outcome TEXT NOT NULL, reasons TEXT NOT NULL,
  prev_hash TEXT NOT NULL, hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS agent_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT, received_at REAL NOT NULL, agent TEXT NOT NULL, kind TEXT,
  capital_bucket TEXT, generated_at TEXT NOT NULL, status_line TEXT NOT NULL, report TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS health_runs (ts REAL NOT NULL, overall TEXT NOT NULL, report TEXT NOT NULL);

-- append-only enforcement for the audit log
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_log
  BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_log
  BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
"""


LT_GUARDS_SQL = """
CREATE TRIGGER IF NOT EXISTS lt_snap_no_update BEFORE UPDATE ON lt_holdings_snapshots
  BEGIN SELECT RAISE(ABORT, 'lt_holdings_snapshots is append-only'); END;
CREATE TRIGGER IF NOT EXISTS lt_snap_no_delete BEFORE DELETE ON lt_holdings_snapshots
  BEGIN SELECT RAISE(ABORT, 'lt_holdings_snapshots is append-only'); END;
-- Account execution policy (Zoorped decision 2026-11-01): who owns/executes each longterm account and
-- whether agents may draft order tickets for it. Agents on a user-executed account are auditors only.
CREATE TABLE IF NOT EXISTS lt_account_policies (
  account_id   TEXT PRIMARY KEY,
  owner        TEXT NOT NULL,
  executor     TEXT NOT NULL CHECK (executor IN ('user')),            -- no agent ever holds execution ownership
  agent_role   TEXT NOT NULL CHECK (agent_role IN ('auditor','drafter')),
  ticketing    TEXT NOT NULL CHECK (ticketing IN ('disabled','draft_only')),
  decided_by   TEXT NOT NULL,
  decided_at   REAL NOT NULL,
  note         TEXT,
  CHECK (NOT (agent_role = 'auditor' AND ticketing <> 'disabled'))
);
INSERT OR IGNORE INTO lt_account_policies VALUES
  ('onepay_roth','user','user','auditor','disabled','Zoorped',1793575800,
   'User buys everything in the OnePay Roth himself. Audit-only: holdings vs targets, off-plan names, cap breaches, drift.');
-- auditor-only accounts are locked: they cannot be loosened or removed in place
CREATE TRIGGER IF NOT EXISTS lt_policy_auditor_locked BEFORE UPDATE ON lt_account_policies
  WHEN OLD.agent_role = 'auditor' AND (NEW.agent_role <> 'auditor' OR NEW.ticketing <> 'disabled' OR NEW.executor <> 'user')
  BEGIN SELECT RAISE(ABORT, 'auditor-only account policy is locked (user-executed account)'); END;
CREATE TRIGGER IF NOT EXISTS lt_policy_no_delete BEFORE DELETE ON lt_account_policies
  WHEN OLD.agent_role = 'auditor'
  BEGIN SELECT RAISE(ABORT, 'auditor-only account policy cannot be deleted'); END;
-- DB-level: no order ticket of any kind for an account whose ticketing is disabled
CREATE TRIGGER IF NOT EXISTS lt_ticket_no_auditor_accounts BEFORE INSERT ON lt_order_tickets
  WHEN EXISTS (SELECT 1 FROM lt_account_policies p WHERE p.account_id = NEW.account_id AND p.ticketing = 'disabled')
  BEGIN SELECT RAISE(ABORT, 'ticketing disabled: account is user-executed and audit-only'); END;
CREATE TRIGGER IF NOT EXISTS lt_ticket_no_move_to_auditor_accounts BEFORE UPDATE OF account_id ON lt_order_tickets
  WHEN EXISTS (SELECT 1 FROM lt_account_policies p WHERE p.account_id = NEW.account_id AND p.ticketing = 'disabled')
  BEGIN SELECT RAISE(ABORT, 'ticketing disabled: account is user-executed and audit-only'); END;
-- a confirmation on an audit-only account is impossible even for a ticket drafted before the policy existed
CREATE TRIGGER IF NOT EXISTS lt_ticket_no_confirm_auditor_accounts BEFORE UPDATE OF status ON lt_order_tickets
  WHEN NEW.status IN ('draft','confirmed_by_user','done_by_user')
   AND EXISTS (SELECT 1 FROM lt_account_policies p WHERE p.account_id = NEW.account_id AND p.ticketing = 'disabled')
  BEGIN SELECT RAISE(ABORT, 'ticketing disabled: account is user-executed and audit-only'); END;
-- a blocked ticket can never be confirmed; confirmation always needs a verbatim quote (LT-10)
CREATE TRIGGER IF NOT EXISTS lt_ticket_confirm_guard BEFORE UPDATE OF status ON lt_order_tickets
  WHEN NEW.status IN ('confirmed_by_user','done_by_user') AND (OLD.guard_result <> 'pass' OR NEW.confirmation_quote IS NULL OR length(trim(NEW.confirmation_quote)) = 0)
  BEGIN SELECT RAISE(ABORT, 'ticket must pass guards and carry a verbatim user confirmation'); END;
"""


def dumps(o) -> str:
    return json.dumps(o, sort_keys=True, default=str, separators=(",", ":"))


class Store:
    def __init__(self, path: str):
        self.path = path
        if path != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self.conn = sqlite3.connect(path, check_same_thread=False, isolation_level=None, timeout=30)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA foreign_keys=ON")
        self.conn.executescript(SCHEMA)
        self.conn.executescript((Path(__file__).parent / "schemas" / "longterm.sql").read_text())   # lt_* (2040 proposal)
        self.conn.executescript(LT_GUARDS_SQL)
        from .grants import SCHEMA as _GRANTS_SQL   # economy_stage_grants (ECONOMY.md E2), append-only
        self.conn.executescript(_GRANTS_SQL)
        self.conn.execute("INSERT INTO meta(key,value) VALUES('schema_version',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (str(SCHEMA_VERSION),))

    # --- helpers
    def tx(self):
        return _Tx(self)

    def execute(self, sql, params=()):
        with self._lock:
            return self.conn.execute(sql, params)

    def query(self, sql, params=()) -> list[dict]:
        with self._lock:
            return [dict(r) for r in self.conn.execute(sql, params).fetchall()]

    def one(self, sql, params=()):
        r = self.query(sql, params)
        return r[0] if r else None

    # --- control flags
    def get_control(self, key, default=None):
        r = self.one("SELECT value FROM control WHERE key=?", (key,))
        return json.loads(r["value"]) if r else default

    def set_control(self, key, value):
        self.execute("INSERT INTO control(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
                     (key, dumps(value), time.time()))

    # --- market data writers
    def upsert_instrument(self, d: dict):
        self.execute("""INSERT INTO instruments(venue,symbol,sector,inst_type,base,quote,contract_value,lot_size,min_size,tick_size,max_leverage,state,raw,updated_at)
            VALUES(:venue,:symbol,:sector,:inst_type,:base,:quote,:contract_value,:lot_size,:min_size,:tick_size,:max_leverage,:state,:raw,:updated_at)
            ON CONFLICT(venue,symbol) DO UPDATE SET sector=excluded.sector,inst_type=excluded.inst_type,base=excluded.base,quote=excluded.quote,
            contract_value=excluded.contract_value,lot_size=excluded.lot_size,min_size=excluded.min_size,tick_size=excluded.tick_size,
            max_leverage=excluded.max_leverage,state=excluded.state,raw=excluded.raw,updated_at=excluded.updated_at""",
                     {**d, "raw": dumps(d.get("raw")), "updated_at": time.time()})

    def insert_quote(self, d: dict):
        self.execute("INSERT INTO quotes(venue,symbol,ts,last,bid,ask,mark,index_px,vol24h,source,fetched_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                     (d["venue"], d["symbol"], d["ts"], d.get("last"), d.get("bid"), d.get("ask"), d.get("mark"), d.get("index_px"),
                      d.get("vol24h"), d["source"], time.time()))

    def upsert_candles(self, rows: list[dict]):
        with self.tx():
            for d in rows:
                self.conn.execute("INSERT OR REPLACE INTO candles(venue,symbol,tf,ts,o,h,l,c,v,source) VALUES(?,?,?,?,?,?,?,?,?,?)",
                                  (d["venue"], d["symbol"], d["tf"], d["ts"], d["o"], d["h"], d["l"], d["c"], d["v"], d["source"]))

    def insert_funding(self, d: dict):
        self.execute("INSERT OR REPLACE INTO funding(venue,symbol,ts,rate,next_funding_ts,interval_h,source) VALUES(?,?,?,?,?,?,?)",
                     (d["venue"], d["symbol"], d["ts"], d["rate"], d.get("next_funding_ts"), d.get("interval_h"), d["source"]))

    def insert_signal(self, sector, source, symbol, kind, payload, score=None, recommendation=None) -> int:
        cur = self.execute("INSERT INTO signals(ts,sector,source,symbol,kind,score,recommendation,payload) VALUES(?,?,?,?,?,?,?,?)",
                           (time.time(), sector, source, symbol, kind, score, recommendation, dumps(payload)))
        return cur.lastrowid

    def latest_signal(self, sector, symbol):
        r = self.one("SELECT * FROM signals WHERE sector=? AND symbol=? ORDER BY ts DESC, id DESC LIMIT 1", (sector, symbol))
        if r:
            r["payload"] = json.loads(r["payload"])
        return r

    def latest_quote(self, venue, symbol):
        return self.one("SELECT * FROM quotes WHERE venue=? AND symbol=? ORDER BY ts DESC LIMIT 1", (venue, symbol))

    def instrument(self, venue, symbol):
        return self.one("SELECT * FROM instruments WHERE venue=? AND symbol=?", (venue, symbol))


class _Tx:
    def __init__(self, s: Store):
        self.s = s

    def __enter__(self):
        self.s._lock.acquire()
        self.s.conn.execute("BEGIN IMMEDIATE")
        return self.s

    def __exit__(self, et, ev, tb):
        try:
            self.s.conn.execute("ROLLBACK" if et else "COMMIT")
        finally:
            self.s._lock.release()
        return False
