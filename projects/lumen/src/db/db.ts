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
  expires_at INTEGER NOT NULL
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

export function allowRate(db: DatabaseSync, bucket: string, limit: number, windowMs: number, now: number): boolean {
  const since = now - windowMs;
  db.prepare("DELETE FROM rate_limits WHERE at_ms < ?").run(since);
  const row = db.prepare("SELECT COUNT(*) AS n FROM rate_limits WHERE bucket = ? AND at_ms >= ?").get(bucket, since) as { n: number };
  if (Number(row.n) >= limit) return false;
  db.prepare("INSERT INTO rate_limits(bucket, at_ms) VALUES(?, ?)").run(bucket, now);
  return true;
}
