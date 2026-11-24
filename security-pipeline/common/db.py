"""SQLite storage with cross-source dedup.

Dedup happens at two levels:
  1. Exact: item id = hash(canonical URL) (or a stable natural key for URL-less records such as
     DeFiLlama rows). The same article seen via two feeds is stored once; `sources` lists both.
  2. Incident clustering: items about the same entity + incident category within +/-4 days share a
     `cluster_id`, so a DeFiLlama record and five news stories about one hack collapse to one incident.
"""
from __future__ import annotations
import json, sqlite3
from datetime import timedelta
from pathlib import Path
from .util import iso, parse_time, sha

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = ROOT / "data" / "intel.db"
INCIDENT_CATS = {"exchange_hack", "defi_exploit", "bridge_exploit", "drainer_phishing",
                 "supply_chain", "rug_pull", "malware", "outage"}
CLUSTER_WINDOW = timedelta(days=4)

SCHEMA = """
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  time_utc TEXT NOT NULL,
  source TEXT NOT NULL,
  sources TEXT NOT NULL,
  source_type TEXT,
  title TEXT NOT NULL,
  url TEXT,
  summary TEXT,
  chain TEXT,
  entity TEXT,
  entity_slug TEXT,
  category TEXT,
  loss_usd REAL,
  status TEXT,
  cluster_id TEXT,
  severity REAL, relevance REAL, tier TEXT, reasons TEXT, matched TEXT,
  first_seen_utc TEXT NOT NULL,
  last_seen_utc TEXT NOT NULL,
  raw TEXT
);
CREATE INDEX IF NOT EXISTS ix_items_time ON items(time_utc);
CREATE INDEX IF NOT EXISTS ix_items_cluster ON items(cluster_id);
CREATE INDEX IF NOT EXISTS ix_items_entity ON items(entity_slug, category);
CREATE TABLE IF NOT EXISTS runs (
  run_id TEXT PRIMARY KEY, started_utc TEXT, finished_utc TEXT, args TEXT, summary TEXT
);
CREATE TABLE IF NOT EXISTS source_runs (
  run_id TEXT, source TEXT, ok INTEGER, n_items INTEGER, n_new INTEGER,
  error TEXT, duration_ms INTEGER, PRIMARY KEY (run_id, source)
);
CREATE TABLE IF NOT EXISTS wallet_findings (
  id TEXT PRIMARY KEY, chain TEXT, address TEXT, kind TEXT, tier TEXT,
  title TEXT, detail TEXT, first_seen_utc TEXT, last_seen_utc TEXT, resolved INTEGER DEFAULT 0
);
"""


def connect(path: Path = DB_PATH) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(path, timeout=30)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    con.executescript(SCHEMA)
    return con


def _cluster_for(con, item: dict) -> str:
    if item.get("entity_slug") and item.get("category") in INCIDENT_CATS:
        t = parse_time(item["time_utc"])
        lo, hi = iso(t - CLUSTER_WINDOW), iso(t + CLUSTER_WINDOW)
        row = con.execute(
            "SELECT cluster_id FROM items WHERE entity_slug=? AND category IN (%s) "
            "AND time_utc BETWEEN ? AND ? AND id<>? ORDER BY time_utc LIMIT 1"
            % ",".join("?" * len(INCIDENT_CATS)),
            (item["entity_slug"], *sorted(INCIDENT_CATS), lo, hi, item["id"]),
        ).fetchone()
        if row and row["cluster_id"]:
            return row["cluster_id"]
        return "c-" + sha(f"{item['entity_slug']}|{item['time_utc'][:10]}", 12)
    if item.get("category") in INCIDENT_CATS and item.get("title"):
        # no entity: fall back to headline similarity within the window (same story, different outlets)
        mine = _tokens(item["title"])
        if len(mine) >= 3:
            t = parse_time(item["time_utc"])
            best, best_j = None, 0.0
            for r in con.execute("SELECT cluster_id, title FROM items WHERE category IN (%s) AND time_utc BETWEEN ? AND ? AND id<>?"
                                 % ",".join("?" * len(INCIDENT_CATS)),
                                 (*sorted(INCIDENT_CATS), iso(t - CLUSTER_WINDOW), iso(t + CLUSTER_WINDOW), item["id"])):
                other = _tokens(r["title"])
                inter = len(mine & other)
                j = inter / max(1, len(mine | other))
                if inter >= 3 and j >= 0.3 and j > best_j:
                    best, best_j = r["cluster_id"], j
            if best:
                return best
    return "c-" + item["id"]


_STOP = {"after", "with", "from", "that", "this", "their", "over", "into", "says", "said", "amid", "following", "crypto",
         "hackers", "hacker", "users", "million", "billion", "about", "what", "when", "will", "have", "been", "more"}


def _tokens(title: str) -> set:
    import re as _re
    return {w for w in _re.findall(r"[a-z0-9]{4,}", title.lower()) if w not in _STOP}


def upsert(con, item: dict, seen_utc: str) -> bool:
    """Insert or merge one normalized item. Returns True if it is new."""
    row = con.execute("SELECT sources, loss_usd, entity_slug, category FROM items WHERE id=?",
                      (item["id"],)).fetchone()
    if row:
        srcs = set(json.loads(row["sources"])) | {item["source"]}
        loss = max(filter(None, [row["loss_usd"], item.get("loss_usd")]), default=None)
        con.execute("UPDATE items SET sources=?, loss_usd=?, last_seen_utc=?, status=COALESCE(?, status) WHERE id=?",
                    (json.dumps(sorted(srcs)), loss, seen_utc, item.get("status"), item["id"]))
        return False
    item = dict(item)
    item["cluster_id"] = _cluster_for(con, item)
    con.execute(
        """INSERT INTO items (id,time_utc,source,sources,source_type,title,url,summary,chain,entity,
           entity_slug,category,loss_usd,status,cluster_id,first_seen_utc,last_seen_utc,raw)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (item["id"], item["time_utc"], item["source"], json.dumps([item["source"]]),
         item.get("source_type"), item["title"], item.get("url"), item.get("summary"),
         item.get("chain"), item.get("entity"), item.get("entity_slug"), item.get("category"),
         item.get("loss_usd"), item.get("status"), item["cluster_id"], seen_utc, seen_utc,
         json.dumps(item.get("raw"))[:20000] if item.get("raw") is not None else None))
    return True
