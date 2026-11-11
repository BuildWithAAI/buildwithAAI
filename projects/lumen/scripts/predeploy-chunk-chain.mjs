import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const file = process.env.LUMEN_DATA ?? "";
if (!file || file === ":memory:" || !existsSync(file)) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event: "chunk_chain_broken", status: 500, route: "predeploy", detail: "missing" }));
  process.exit(1);
}

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
  rows = db.prepare("SELECT id, at_ms, chunk_x, chunk_y, tile_x, tile_y, kind, payload, actor, idempotency_key, prev_hash, body_hash, entry_hash FROM chunk_edits ORDER BY seq ASC").all();
} catch {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event: "chunk_chain_broken", status: 500, route: "predeploy" }));
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
