-- Proposal from 2040 Future Agent for /workspace/aai (data/aai.db, SQLite).
-- Status: PROPOSAL ONLY. Not applied. AAI Terminal owns the repo and decides adoption.
-- Convention (matches aai/store.py): snake_case; timestamps are REAL unix epoch seconds (ts, *_at, as_of);
-- JSON payloads as TEXT; every row carries `source` so manual vs connector data is never confused.

-- 1. Capital buckets: the hard wall between long-term holds and trading capital.
CREATE TABLE IF NOT EXISTS lt_accounts (
  account_id     TEXT PRIMARY KEY,          -- e.g. 'onepay_roth', 'robinhood', 'trezor'
  display_name   TEXT NOT NULL,
  custodian      TEXT NOT NULL,             -- OnePay, Robinhood, Trezor, Phantom, Exodus, Bybit, Blofin
  account_type   TEXT NOT NULL CHECK (account_type IN
                   ('roth_ira','taxable_brokerage','cold_wallet','hot_wallet','exchange_spot','exchange_derivs')),
  capital_bucket TEXT NOT NULL CHECK (capital_bucket IN ('longterm','trading')),
  connected      INTEGER NOT NULL DEFAULT 0, -- 1 only when a read-only feed is live
  feed           TEXT NOT NULL DEFAULT 'none' CHECK (feed IN ('none','manual','plaid','exchange_readonly_api','onchain_public')),
  notes          TEXT
);

-- 2. Sleeves (60% VTI core / 40% themes, plus a separate crypto core sleeve).
CREATE TABLE IF NOT EXISTS lt_sleeves (
  sleeve_id      TEXT PRIMARY KEY,          -- 'core','ai_infra','space','minerals','robotics','future_energy','frontier','crypto_core'
  portfolio      TEXT NOT NULL CHECK (portfolio IN ('stocks_2040','crypto_longterm')),
  target_pct     REAL NOT NULL,             -- % of its portfolio
  band_low_pct   REAL NOT NULL,
  band_high_pct  REAL NOT NULL
);

-- 3. Per-instrument targets and caps.
CREATE TABLE IF NOT EXISTS lt_targets (
  symbol           TEXT PRIMARY KEY,
  sleeve_id        TEXT NOT NULL REFERENCES lt_sleeves(sleeve_id),
  asset_class      TEXT NOT NULL CHECK (asset_class IN ('etf','stock','crypto','nft')),
  tier             TEXT NOT NULL CHECK (tier IN ('core_anchor','growth','speculative')),
  priority         INTEGER NOT NULL DEFAULT 0,   -- 1 = TMC/SPCE/SLDP priority names (buy order, not size)
  target_pct       REAL NOT NULL,                -- % of each contribution / portfolio
  stop_add_pct     REAL,                         -- e.g. 3.0 for speculative
  trim_above_pct   REAL,                         -- e.g. 5.0 for speculative
  max_pct          REAL,                         -- incl. fund overlap where noted
  preferred_account TEXT REFERENCES lt_accounts(account_id),
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','watch','pending_listing','retired')),
  updated_at       REAL NOT NULL
);

-- 4. Holdings snapshots (append-only). Empty until a feed or a manual import exists.
CREATE TABLE IF NOT EXISTS lt_holdings_snapshots (
  snapshot_id    TEXT NOT NULL,
  as_of          REAL NOT NULL,
  account_id     TEXT NOT NULL REFERENCES lt_accounts(account_id),
  symbol         TEXT NOT NULL,
  quantity       REAL NOT NULL,
  cost_basis_usd REAL,
  price_usd      REAL,
  value_usd      REAL,
  source         TEXT NOT NULL CHECK (source IN ('manual','plaid','exchange_readonly_api','onchain_public')),
  verified       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (snapshot_id, account_id, symbol)
);

-- 5. Crypto core rules: never fully sell, recover initials on strength, add every bear cycle.
CREATE TABLE IF NOT EXISTS lt_crypto_core (
  symbol                 TEXT PRIMARY KEY,
  never_fully_sell       INTEGER NOT NULL DEFAULT 1,
  core_floor_qty         REAL,              -- quantity no ticket may sell below (decision for Zoorped)
  initial_capital_usd    REAL,              -- unknown until Zoorped supplies it
  initials_recovered_usd REAL NOT NULL DEFAULT 0,
  recover_trigger        TEXT,              -- e.g. 'price >= 2x avg cost AND cycle_phase = strength'
  bear_add_rule          TEXT,              -- e.g. 'cycle_phase = bear -> DCA amount X monthly'
  cold_storage_required  INTEGER NOT NULL DEFAULT 1,
  updated_at             REAL NOT NULL
);

-- 6. Market cycle read used by the crypto rules (one row per review).
CREATE TABLE IF NOT EXISTS lt_cycle_reads (
  as_of        REAL PRIMARY KEY,
  asset        TEXT NOT NULL DEFAULT 'BTC',
  phase        TEXT NOT NULL CHECK (phase IN ('bear_accumulation','neutral','strength_recover_initials')),
  evidence     TEXT NOT NULL,
  source_urls  TEXT                          -- JSON array
);

-- 7. Theses and material developments (sourced).
CREATE TABLE IF NOT EXISTS lt_theses (
  symbol         TEXT PRIMARY KEY,
  thesis         TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('intact','watch','weakened','broken')),
  kill_criteria  TEXT,
  next_catalyst  TEXT,
  next_catalyst_date TEXT,
  last_reviewed_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS lt_developments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol      TEXT NOT NULL,
  event_date  TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('earnings','regulatory','product','financing','listing','security_incident','macro','other')),
  summary     TEXT NOT NULL,
  impact      TEXT NOT NULL CHECK (impact IN ('positive','neutral','negative','unknown')),
  source_url  TEXT NOT NULL,
  recorded_at REAL NOT NULL
);

-- 8. Drift / cap checks (one row per check per run).
CREATE TABLE IF NOT EXISTS lt_drift_checks (
  run_id      TEXT NOT NULL,
  as_of       REAL NOT NULL,
  scope       TEXT NOT NULL CHECK (scope IN ('sleeve','symbol','speculative_total','account')),
  key         TEXT NOT NULL,
  target_pct  REAL,
  actual_pct  REAL,               -- NULL when holdings unknown
  band_low_pct REAL,
  band_high_pct REAL,
  breach      TEXT NOT NULL CHECK (breach IN ('none','below','above','cap_stop_add','cap_trim','unknown')),
  PRIMARY KEY (run_id, scope, key)
);

-- 9. Contribution plan and draft tickets. Tickets are DRAFTS; only Zoorped executes.
CREATE TABLE IF NOT EXISTS lt_contribution_plans (
  month        TEXT NOT NULL,      -- 'YYYY-MM'
  account_id   TEXT NOT NULL REFERENCES lt_accounts(account_id),
  amount_usd   REAL,               -- NULL until Zoorped sets monthly amounts
  split_json   TEXT NOT NULL,      -- {"VTI":60,"SMH":5,...} percentages
  PRIMARY KEY (month, account_id)
);
CREATE TABLE IF NOT EXISTS lt_order_tickets (
  ticket_id     TEXT PRIMARY KEY,
  created_at    REAL NOT NULL,
  agent         TEXT NOT NULL,     -- '2040_future'
  account_id    TEXT NOT NULL REFERENCES lt_accounts(account_id),
  symbol        TEXT NOT NULL,
  side          TEXT NOT NULL CHECK (side IN ('buy','sell','transfer_to_cold')),
  amount_usd    REAL,
  quantity      REAL,
  rationale     TEXT NOT NULL,
  rule_refs     TEXT NOT NULL,     -- JSON array e.g. ["spec_cap_10","crypto_never_fully_sell"]
  guard_result  TEXT NOT NULL CHECK (guard_result IN ('pass','blocked')),
  guard_reasons TEXT,
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed_by_user','rejected','expired','done_by_user')),
  confirmed_at  REAL,              -- set only from an explicit Zoorped message, quoted in audit log
  confirmation_quote TEXT
);

-- Audit: reuse aai's hash-chained append-only audit_log (actor='2040_future').
-- Proposed events: lt_snapshot_ingested, lt_drift_checked, lt_ticket_drafted, lt_ticket_blocked,
-- lt_ticket_confirmed_by_user (inputs must contain Zoorped's verbatim confirmation), lt_review_published.
-- Risk engine: the existing SECTORS tuple in aai/models.py includes 'longterm'; proposal is that
-- longterm ideas are rejected by risk.py's trade path (no 'ideas' rows) and handled only via lt_order_tickets.
