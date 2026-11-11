import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const file = process.env.LUMEN_DATA ?? "";
if (!file || file === ":memory:" || !existsSync(file)) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event: "chunk_chain_broken", status: 500, route: "predeploy", detail: "missing" }));
  process.exit(1);
}
if (statSync(file).size === 0) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event: "chunk_chain_broken", status: 500, route: "predeploy", detail: "empty" }));
  process.exit(1);
}

const LUMEN_TABLES = new Set([
  "kv", "feed", "diary", "creations", "messages", "gifts", "ledger_entries", "flags",
  "webhook_events", "disputes", "checkouts", "deliveries", "sessions", "rate_limits",
  "audit", "proposals", "sol_orders", "sol_refund_flags", "checkout_queue", "paper_trades",
  "price_quotes", "expected_spends", "purchase_claims", "print_orders", "alert_retries",
  "world_agents", "world_log", "owner_alerts", "ideas", "findings", "research_queries",
  "research_pending", "world_builds", "world_build_versions", "creative_log", "zoora_goals",
  "zoora_goal_history", "shop", "shop_listings", "shop_orders", "provenance", "keeper_wishlist",
  "keeper_inventory", "telegram_outbox", "telegram_drops", "research_briefs", "world_visitors",
  "visitor_quarantine",
]);

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortValue(value[key]);
    return out;
  }
  return value;
}

function bodyHash(row) {
  return createHash("sha256").update(JSON.stringify(sortValue({
    id: row.id,
    atMs: row.at_ms,
    idempotencyKey: row.idempotency_key,
    chunkX: row.chunk_x,
    chunkY: row.chunk_y,
    tileX: row.tile_x,
    tileY: row.tile_y,
    kind: row.kind,
    payload: row.payload,
    actor: row.actor,
  }))).digest("hex");
}

const db = new DatabaseSync(file, { readOnly: true });
let rows = [];
try {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
  const names = tables.map((row) => row.name);
  if (!names.includes("chunk_edits")) {
    const live = names.some((name) => LUMEN_TABLES.has(name) || /chunk/i.test(name));
    if (live) {
      console.log(JSON.stringify({ ts: new Date().toISOString(), event: "chunk_chain_broken", status: 500, route: "predeploy", detail: "chunk_edits missing on a live database" }));
      db.close();
      process.exit(1);
    }
    console.log(JSON.stringify({ ts: new Date().toISOString(), event: "chunk_chain_absent", status: 200, route: "predeploy", detail: "fresh database" }));
    db.close();
    process.exit(0);
  }
  rows = db.prepare("SELECT id, at_ms, chunk_x, chunk_y, tile_x, tile_y, kind, payload, actor, idempotency_key, prev_hash, body_hash, entry_hash FROM chunk_edits ORDER BY seq ASC").all();
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  console.log(JSON.stringify({ ts: new Date().toISOString(), event: "predeploy_error", status: 500, route: "predeploy", detail: detail.slice(0, 200) }));
  try { db.close(); } catch { /* already closed */ }
  process.exit(1);
}
let prev = "GENESIS";
for (const row of rows) {
  const hash = bodyHash(row);
  const entry = createHash("sha256").update(prev + hash).digest("hex");
  if (hash !== row.body_hash || row.prev_hash !== prev || entry !== row.entry_hash) {
    console.log(JSON.stringify({ ts: new Date().toISOString(), event: "chunk_chain_broken", status: 500, route: "predeploy" }));
    process.exit(1);
  }
  prev = entry;
}
db.close();
