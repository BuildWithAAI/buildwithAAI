import type { DatabaseSync } from "node:sqlite";
import { movePrintAssets } from "../fulfillment/pod";
import { inheritTaint } from "../security/taint";
import { currentCaps, ladderMode } from "./ladder";
import { getPlan, savePlan } from "./plans";
import { ensureVentures, getVenture, type Venture } from "./ventures";

/**
 * Merging two ventures, the way two companies merge. One is absorbed into the other.
 *
 * Everything the absorbed venture has becomes the survivor's: its income and cost lines, its unspent
 * budget, its products and its orders. The survivor keeps its own name and plan, and takes on the
 * other's start-up and running costs so its plan still adds up. The later time limit stands. The
 * absorbed venture stays on record as "merged", pointing at the survivor, and each moved line remembers
 * where it came from, so the history can always be read.
 *
 * Three things do not bend. The two must be in the same book: the land keeps its own accounts and is
 * never merged with the company's. A mark from outside travels with what it was on, so merging a marked
 * venture marks the survivor. And a merger is the owner's decision; it is done in one step or not at all.
 */

export type Merger = { id: number; fromId: string; intoId: string; atMs: number; linesMoved: number; budgetMovedCents: number; productsMoved: number; ordersMoved: number };

function ensureMergers(db: DatabaseSync): void {
  ensureVentures(db);
  db.exec(`CREATE TABLE IF NOT EXISTS econ_venture_mergers (
    id INTEGER PRIMARY KEY AUTOINCREMENT, from_id TEXT NOT NULL, into_id TEXT NOT NULL, at_ms INTEGER NOT NULL,
    lines_moved INTEGER NOT NULL, budget_moved_cents INTEGER NOT NULL, products_moved INTEGER NOT NULL, orders_moved INTEGER NOT NULL
  )`);
}

const MERGEABLE = ["setup", "active", "paused"];

export function mergeVentures(db: DatabaseSync, fromId: string, intoId: string, now: number): { venture: Venture; merger: Merger } {
  ensureMergers(db);
  if (fromId === intoId) throw new Error("ECON_MERGE_SAME");
  const from = getVenture(db, fromId);
  const into = getVenture(db, intoId);
  if (!from || !into) throw new Error("ECON_VENTURE_UNKNOWN");
  if (!MERGEABLE.includes(from.status) || !MERGEABLE.includes(into.status)) throw new Error("ECON_VENTURE_STATE");
  if (from.bookId !== into.bookId) throw new Error("ECON_MERGE_BOOKS");
  const budget = into.budgetCents + from.budgetCents;
  if (ladderMode(db) === "earned" && budget > currentCaps(db, now).ventureCents) throw new Error("ECON_VENTURE_CAP");
  const deadline = Math.max(into.deadlineMs ?? 0, from.deadlineMs ?? 0) || null;
  db.exec("BEGIN IMMEDIATE");
  try {
    const lines = db.prepare("UPDATE econ_venture_lines SET venture_id = ?, from_venture = COALESCE(from_venture, ?) WHERE venture_id = ?").run(intoId, fromId, fromId);
    const moved = movePrintAssets(db, fromId, intoId);
    db.prepare("UPDATE econ_ventures SET budget_cents = ?, deadline_ms = ? WHERE id = ?").run(budget, deadline, intoId);
    db.prepare("UPDATE econ_ventures SET status = 'merged', merged_into = ?, budget_cents = 0, note = ? WHERE id = ?").run(intoId, `Merged into ${into.name}.`, fromId);
    // Day-one items the owner ticked stay with the survivor only. The absorbed venture's are dropped.
    db.prepare("DELETE FROM econ_venture_checks WHERE venture_id = ?").run(fromId);
    const intoPlan = getPlan(db, intoId);
    const fromPlan = getPlan(db, fromId);
    if (intoPlan && fromPlan) {
      const tag = (label: string) => `${label} (from ${from.name})`.slice(0, 60);
      savePlan(db, intoId, { ...intoPlan, startup: [...intoPlan.startup, ...fromPlan.startup.map((line) => ({ label: tag(line.label), cents: line.cents }))].slice(0, 12), monthly: [...intoPlan.monthly, ...fromPlan.monthly.map((line) => ({ label: tag(line.label), cents: line.cents }))].slice(0, 12), budgetAskCents: intoPlan.budgetAskCents + fromPlan.budgetAskCents }, "owner", now);
    }
    inheritTaint(db, [{ kind: "venture", ref: fromId }], { kind: "venture", ref: intoId }, now);
    const added = db.prepare("INSERT INTO econ_venture_mergers(from_id, into_id, at_ms, lines_moved, budget_moved_cents, products_moved, orders_moved) VALUES(?, ?, ?, ?, ?, ?, ?)").run(fromId, intoId, now, Number(lines.changes), from.budgetCents, moved.products, moved.orders);
    db.exec("COMMIT");
    return { venture: getVenture(db, intoId)!, merger: { id: Number(added.lastInsertRowid), fromId, intoId, atMs: now, linesMoved: Number(lines.changes), budgetMovedCents: from.budgetCents, productsMoved: moved.products, ordersMoved: moved.orders } };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function listMergers(db: DatabaseSync): Merger[] {
  ensureMergers(db);
  return (db.prepare("SELECT * FROM econ_venture_mergers ORDER BY id DESC").all() as { id: number; from_id: string; into_id: string; at_ms: number; lines_moved: number; budget_moved_cents: number; products_moved: number; orders_moved: number }[]).map((row) => ({ id: Number(row.id), fromId: row.from_id, intoId: row.into_id, atMs: Number(row.at_ms), linesMoved: Number(row.lines_moved), budgetMovedCents: Number(row.budget_moved_cents), productsMoved: Number(row.products_moved), ordersMoved: Number(row.orders_moved) }));
}
