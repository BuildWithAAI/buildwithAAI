import type { DatabaseSync } from "node:sqlite";

/**
 * Every tick writes feed, diary and audit rows, and nothing removed them. At an 8 second tick that is
 * tens of thousands of rows a day. The latest rows stay. Older ones are counted into one row per day
 * and removed. The ledger, the chunk log and every other table are not touched here.
 */
export const KEEP_ROWS = { feed: 20_000, diary: 20_000, audit: 20_000 } as const;
/** Only the per-tick audit kinds are pruned. Crisis, login and money audits are kept. */
const TICK_AUDITS = ["decide", "speak", "act"] as const;
const DAY_MS = 86_400_000;

export type PruneResult = { feed: number; diary: number; audit: number };

export function pruneHistory(db: DatabaseSync, keep: { feed: number; diary: number; audit: number } = KEEP_ROWS): PruneResult {
  db.exec(`CREATE TABLE IF NOT EXISTS history_days (
    day TEXT PRIMARY KEY,
    feed_rows INTEGER NOT NULL DEFAULT 0,
    diary_rows INTEGER NOT NULL DEFAULT 0,
    audit_rows INTEGER NOT NULL DEFAULT 0
  )`);
  const result: PruneResult = { feed: 0, diary: 0, audit: 0 };
  db.exec("BEGIN IMMEDIATE");
  try {
    result.feed = roll(db, "feed", "created_at", "feed_rows", keep.feed, "");
    result.diary = roll(db, "diary", "created_at", "diary_rows", keep.diary, "");
    const kinds = TICK_AUDITS.map((kind) => `'${kind}'`).join(",");
    result.audit = roll(db, "audit", "at_ms", "audit_rows", keep.audit, `kind IN (${kinds})`);
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* no open transaction */ }
    throw error;
  }
  return result;
}

/** Table, column and filter are constants from this file, never request data. */
function roll(db: DatabaseSync, table: "feed" | "diary" | "audit", stamp: "created_at" | "at_ms", column: "feed_rows" | "diary_rows" | "audit_rows", keep: number, filter: string): number {
  const where = filter ? `WHERE ${filter}` : "";
  const edge = db.prepare(`SELECT id FROM ${table} ${where} ORDER BY id DESC LIMIT 1 OFFSET ?`).get(Math.max(0, Math.floor(keep))) as { id: number } | undefined;
  if (!edge) return 0;
  const old = filter ? `id <= ? AND ${filter}` : "id <= ?";
  const days = db.prepare(`SELECT ${stamp} / ${DAY_MS} AS day, COUNT(*) AS n FROM ${table} WHERE ${old} GROUP BY day`).all(edge.id) as { day: number; n: number }[];
  for (const row of days) {
    const day = new Date(Number(row.day) * DAY_MS).toISOString().slice(0, 10);
    db.prepare(`INSERT INTO history_days(day, ${column}) VALUES(?, ?) ON CONFLICT(day) DO UPDATE SET ${column} = ${column} + excluded.${column}`).run(day, Number(row.n));
  }
  const removed = db.prepare(`DELETE FROM ${table} WHERE ${old}`).run(edge.id);
  return Number(removed.changes ?? 0);
}
