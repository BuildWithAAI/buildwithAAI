-- creator-hub SQLite schema v1 (node:sqlite). Owned jointly; change only with a migration note in README.
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS clicks (
  id INTEGER PRIMARY KEY,
  ts INTEGER NOT NULL,
  offer_id TEXT NOT NULL,
  video_id TEXT,
  source TEXT,
  country TEXT,
  visitor_hash TEXT NOT NULL,
  is_bot INTEGER NOT NULL DEFAULT 0,
  outcome TEXT NOT NULL,
  referrer_host TEXT
);
CREATE INDEX IF NOT EXISTS clicks_offer_ts ON clicks (offer_id, ts);
CREATE INDEX IF NOT EXISTS clicks_video ON clicks (video_id);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  ts INTEGER NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  company TEXT,
  project_url TEXT,
  package_id TEXT NOT NULL,
  budget TEXT,
  deadline TEXT,
  message TEXT NOT NULL,
  consent INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  visitor_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS page_events (
  id INTEGER PRIMARY KEY,
  ts INTEGER NOT NULL,
  page TEXT NOT NULL,          -- 'subscribe' | 'studio' | 'disclosures' | ...
  source TEXT,
  video_id TEXT,
  country TEXT,
  visitor_hash TEXT NOT NULL,
  is_bot INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS page_events_page_ts ON page_events (page, ts);
