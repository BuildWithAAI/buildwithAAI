import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { migrateMerchantHashes } from "../money/ledger";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS feed (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS diary (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  tone TEXT NOT NULL,
  private INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS creations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  svg TEXT NOT NULL,
  listed INTEGER NOT NULL,
  price_cents INTEGER,
  likes INTEGER NOT NULL,
  favorites INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  author TEXT NOT NULL,
  body TEXT NOT NULL,
  untrusted INTEGER NOT NULL,
  status TEXT NOT NULL,
  reply TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS gifts (
  id TEXT PRIMARY KEY,
  gift_id TEXT NOT NULL,
  note TEXT NOT NULL,
  untrusted INTEGER NOT NULL,
  author TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ledger_entries (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  at_ms INTEGER NOT NULL,
  kind TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL,
  provider TEXT,
  provider_transaction_id TEXT,
  charge_id TEXT,
  payment_intent_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  body_hash TEXT NOT NULL,
  ref TEXT,
  note TEXT NOT NULL,
  merchant TEXT,
  prev_hash TEXT NOT NULL,
  entry_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS flags (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS webhook_events (
  event_id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  processed_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS disputes (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  charge_id TEXT,
  reason TEXT,
  open INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS checkouts (
  id TEXT PRIMARY KEY,
  creation_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  session_id TEXT,
  url TEXT,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS deliveries (
  token TEXT PRIMARY KEY,
  creation_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  charge_id TEXT,
  payment_intent_id TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket TEXT NOT NULL,
  at_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at_ms INTEGER NOT NULL,
  kind TEXT NOT NULL,
  detail TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS proposals (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sol_orders (
  id TEXT PRIMARY KEY,
  item_kind TEXT NOT NULL,
  item_id TEXT NOT NULL,
  title TEXT NOT NULL,
  usd_cents INTEGER NOT NULL,
  lamports INTEGER NOT NULL,
  sol_usd_micro INTEGER NOT NULL,
  recipient TEXT NOT NULL,
  reference_key TEXT NOT NULL UNIQUE,
  signature TEXT UNIQUE,
  status TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sol_refund_flags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL,
  signature TEXT NOT NULL,
  reason TEXT NOT NULL,
  lamports TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS checkout_queue (
  id TEXT PRIMARY KEY,
  intent_id TEXT NOT NULL UNIQUE,
  merchant TEXT NOT NULL,
  max_cents INTEGER NOT NULL,
  status TEXT NOT NULL,
  claim_token TEXT,
  claimed_at INTEGER,
  expires_at INTEGER NOT NULL,
  order_number TEXT,
  charged_cents INTEGER,
  receipt TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS paper_trades (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  mint TEXT NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  usd_cents INTEGER NOT NULL,
  sol_micro INTEGER NOT NULL,
  price_usd TEXT NOT NULL,
  price_sol TEXT NOT NULL,
  quoted_at INTEGER NOT NULL,
  status TEXT NOT NULL,
  thesis TEXT NOT NULL,
  exit_plan TEXT NOT NULL,
  result TEXT,
  signature TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS price_quotes (
  mint TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  price_usd TEXT NOT NULL,
  price_sol TEXT NOT NULL,
  quoted_at INTEGER NOT NULL,
  pair_created_at INTEGER
);
CREATE TABLE IF NOT EXISTS expected_spends (
  intent_id TEXT PRIMARY KEY,
  merchant TEXT NOT NULL,
  max_cents INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS purchase_claims (
  intent_id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  ledger_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS print_orders (
  id TEXT PRIMARY KEY,
  design_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  adapter TEXT NOT NULL,
  material TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  estimated_cost_cents INTEGER,
  created_at INTEGER NOT NULL,
  reason TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS alert_retries (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  next_at INTEGER NOT NULL,
  channel TEXT NOT NULL DEFAULT 'email',
  started_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS world_agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL,
  resident INTEGER NOT NULL,
  present INTEGER NOT NULL,
  place_id TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  z REAL NOT NULL,
  dest_place TEXT,
  path_json TEXT NOT NULL,
  depart_at INTEGER,
  arrive_at INTEGER,
  activity TEXT NOT NULL,
  speech TEXT NOT NULL,
  feeling TEXT NOT NULL,
  joined_at INTEGER NOT NULL,
  seen_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS world_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS owner_alerts (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ideas (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  why TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  source_key TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS findings (
  id TEXT PRIMARY KEY,
  idea_id TEXT NOT NULL,
  question TEXT NOT NULL,
  summary TEXT NOT NULL,
  source_url TEXT NOT NULL,
  at_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS research_queries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at_ms INTEGER NOT NULL,
  question TEXT
);
CREATE TABLE IF NOT EXISTS research_pending (
  id TEXT PRIMARY KEY,
  idea_id TEXT NOT NULL,
  question TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  snippet TEXT NOT NULL,
  at_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS world_builds (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  place_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  why TEXT NOT NULL,
  emotion TEXT NOT NULL,
  x REAL NOT NULL,
  z REAL NOT NULL,
  size REAL NOT NULL,
  yaw REAL NOT NULL,
  status TEXT NOT NULL,
  materials INTEGER NOT NULL,
  influenced INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  params TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS world_build_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  build_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL,
  at_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS creative_log (
  build_id TEXT PRIMARY KEY,
  sha TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  at_ms INTEGER NOT NULL,
  undone INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS zoora_goals (
  id TEXT PRIMARY KEY,
  horizon TEXT NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL,
  source TEXT NOT NULL,
  version INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS zoora_goal_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  goal_id TEXT NOT NULL,
  action TEXT NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL,
  at_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS shop (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  story TEXT NOT NULL,
  hue INTEGER NOT NULL,
  form INTEGER NOT NULL,
  x REAL NOT NULL,
  z REAL NOT NULL,
  open INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS shop_listings (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  status TEXT NOT NULL,
  scope TEXT NOT NULL,
  turnaround_hours INTEGER NOT NULL,
  file_body TEXT NOT NULL,
  version INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS shop_orders (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL,
  buyer_note TEXT NOT NULL,
  status TEXT NOT NULL,
  charge_id TEXT,
  payment_intent_id TEXT,
  delivery_token TEXT,
  due_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  buyer_ip TEXT
);
CREATE TABLE IF NOT EXISTS provenance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  piece_kind TEXT NOT NULL,
  piece_id TEXT NOT NULL,
  diary_id INTEGER,
  mood_json TEXT,
  memory_ids TEXT NOT NULL,
  goal_id TEXT,
  research_id TEXT,
  visitor_text TEXT,
  at_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS keeper_wishlist (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  why TEXT NOT NULL,
  link TEXT,
  estimate_cents INTEGER,
  rank INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS keeper_inventory (
  id TEXT PRIMARY KEY,
  wishlist_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  note TEXT NOT NULL,
  at_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS telegram_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL,
  at_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS telegram_drops (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  at_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS research_briefs (
  idea_id TEXT PRIMARY KEY,
  problem TEXT NOT NULL,
  who_pays TEXT NOT NULL,
  costs TEXT NOT NULL,
  risks TEXT NOT NULL,
  first_test TEXT NOT NULL,
  at_ms INTEGER NOT NULL
);
CREATE TRIGGER IF NOT EXISTS ledger_no_update BEFORE UPDATE ON ledger_entries
BEGIN SELECT RAISE(ABORT, 'append-only'); END;
CREATE TRIGGER IF NOT EXISTS ledger_no_delete BEFORE DELETE ON ledger_entries
BEGIN SELECT RAISE(ABORT, 'append-only'); END;
`;

export function openDatabase(file = ":memory:"): DatabaseSync {
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  db.exec("PRAGMA journal_mode = WAL");
  ensureColumn(db, "ledger_entries", "charge_id", "charge_id TEXT");
  ensureColumn(db, "ledger_entries", "payment_intent_id", "payment_intent_id TEXT");
  ensureColumn(db, "ledger_entries", "merchant", "merchant TEXT");
  ensureColumn(db, "alert_retries", "channel", "channel TEXT NOT NULL DEFAULT 'email'");
  ensureColumn(db, "alert_retries", "started_at", "started_at INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "research_queries", "question", "question TEXT");
  ensureColumn(db, "ideas", "source_key", "source_key TEXT");
  ensureColumn(db, "world_builds", "params", "params TEXT NOT NULL DEFAULT '{}'");
  ensureColumn(db, "shop_orders", "buyer_ip", "buyer_ip TEXT");
  ensureColumn(db, "deliveries", "charge_id", "charge_id TEXT");
  ensureColumn(db, "deliveries", "payment_intent_id", "payment_intent_id TEXT");
  ensureColumn(db, "shop_orders", "payment_intent_id", "payment_intent_id TEXT");
  ensureColumn(db, "price_quotes", "pair_created_at", "pair_created_at INTEGER");
  db.prepare("DELETE FROM kv WHERE key = 'world_token_flash'").run();
  migrateMerchantHashes(db);
  return db;
}

function ensureColumn(db: DatabaseSync, table: string, column: string, ddl: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((col) => col.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

export function kvGet(db: DatabaseSync, key: string): string | null {
  const row = db.prepare("SELECT value FROM kv WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function kvSet(db: DatabaseSync, key: string, value: string): void {
  db.prepare("INSERT INTO kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

export function flag(db: DatabaseSync, key: string, fallback = "0"): string {
  const row = db.prepare("SELECT value FROM flags WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? fallback;
}

export function setFlag(db: DatabaseSync, key: string, value: string): void {
  db.prepare("INSERT INTO flags(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

export const GUESTBOOK_IP_LIMIT = 8;
export const GUESTBOOK_GLOBAL_LIMIT = 30;
const GUESTBOOK_WINDOW_MS = 3_600_000;

/** Per-address cap plus one shared cap, counted together so a flood cannot fill the book. */
export function allowGuestNote(db: DatabaseSync, ip: string, now: number, limits = { perIp: GUESTBOOK_IP_LIMIT, global: GUESTBOOK_GLOBAL_LIMIT }): boolean {
  const since = now - GUESTBOOK_WINDOW_MS;
  const ipBucket = `book:${ip}`;
  db.exec("BEGIN IMMEDIATE");
  try {
    const count = (bucket: string) => Number((db.prepare("SELECT COUNT(*) AS n FROM rate_limits WHERE bucket = ? AND at_ms >= ?").get(bucket, since) as { n: number }).n);
    if (count(ipBucket) >= limits.perIp || count("book:global") >= limits.global) {
      db.exec("COMMIT");
      return false;
    }
    const insert = db.prepare("INSERT INTO rate_limits(bucket, at_ms) VALUES(?, ?)");
    insert.run(ipBucket, now);
    insert.run("book:global", now);
    db.exec("COMMIT");
    return true;
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* already closed */ }
    throw error;
  }
}

export function allowRate(db: DatabaseSync, bucket: string, limit: number, windowMs: number, now: number): boolean {
  const since = now - windowMs;
  db.prepare("DELETE FROM rate_limits WHERE at_ms < ?").run(since);
  const row = db.prepare("SELECT COUNT(*) AS n FROM rate_limits WHERE bucket = ? AND at_ms >= ?").get(bucket, since) as { n: number };
  if (Number(row.n) >= limit) return false;
  db.prepare("INSERT INTO rate_limits(bucket, at_ms) VALUES(?, ?)").run(bucket, now);
  return true;
}
