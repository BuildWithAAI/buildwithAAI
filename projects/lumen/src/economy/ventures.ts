import type { DatabaseSync } from "node:sqlite";
import { inheritTaint, untainted, type TaintKind } from "../security/taint";
import { addEntry, ensureEconomy, type BookId } from "./economy";
import { currentCaps, ladderMode } from "./ladder";

/**
 * The venture desk. A venture is one way Zoora tries to earn: a print line, a shop, a white-label
 * product, a blog, land.
 *
 * She proposes. The owner approves it with a budget and a time limit, or declines it. A venture that
 * runs out of time is paused, and one that runs out of budget cannot spend. Each has its own scorecard,
 * so an idea that does not pay is seen and closed instead of quietly costing money.
 *
 * The budget is what a venture may lose, not what it may turn over. A sale the customer already paid
 * for covers its own cost, so it is never stopped by the budget. Samples, fees and tools are.
 */

export const VENTURE_KINDS = ["prints", "shop", "white-label", "art", "writing", "land", "trading", "other"] as const;
export type VentureKind = (typeof VENTURE_KINDS)[number];
export type VentureStatus = "proposed" | "active" | "paused" | "closed" | "declined";
export const MAX_VENTURE_DAYS = 365;
const MAX_CENTS = 1_000_000_000_000;
const ID = /^[a-z0-9-]{2,40}$/;

export function ensureVentures(db: DatabaseSync): void {
  ensureEconomy(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS econ_ventures (
      id TEXT PRIMARY KEY, book_id TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, pitch TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL, budget_cents INTEGER NOT NULL DEFAULT 0, deadline_ms INTEGER,
      proposed_by TEXT NOT NULL, created_at INTEGER NOT NULL, decided_at INTEGER, note TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS econ_venture_lines (
      idem TEXT PRIMARY KEY, venture_id TEXT NOT NULL, kind TEXT NOT NULL, cents INTEGER NOT NULL, at_ms INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS econ_venture_lines_venture ON econ_venture_lines(venture_id);
  `);
}

function clean(text: string, max: number): string {
  const value = text.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
  if (/\d{8,}/.test(value.replace(/[\s-]/g, ""))) throw new Error("ECON_NUMBER_REFUSED");
  return value;
}

export type Venture = {
  id: string;
  bookId: BookId;
  name: string;
  kind: VentureKind;
  pitch: string;
  status: VentureStatus;
  budgetCents: number;
  deadlineMs: number | null;
  proposedBy: "zoora" | "owner";
  createdAt: number;
  note: string;
};

type Row = { id: string; book_id: BookId; name: string; kind: VentureKind; pitch: string; status: VentureStatus; budget_cents: number; deadline_ms: number | null; proposed_by: "zoora" | "owner"; created_at: number; note: string };

function shape(row: Row): Venture {
  return { id: row.id, bookId: row.book_id, name: row.name, kind: row.kind, pitch: row.pitch, status: row.status, budgetCents: Number(row.budget_cents), deadlineMs: row.deadline_ms == null ? null : Number(row.deadline_ms), proposedBy: row.proposed_by, createdAt: Number(row.created_at), note: row.note };
}

export function getVenture(db: DatabaseSync, id: string): Venture | null {
  ensureVentures(db);
  const row = db.prepare("SELECT * FROM econ_ventures WHERE id = ?").get(id) as Row | undefined;
  return row ? shape(row) : null;
}

export function listVentures(db: DatabaseSync): Venture[] {
  ensureVentures(db);
  return (db.prepare("SELECT * FROM econ_ventures ORDER BY created_at DESC, id").all() as Row[]).map(shape);
}

export type ProposeInput = { id: string; name: string; kind: string; pitch?: string; by: "zoora" | "owner"; behind?: { kind: TaintKind; ref: string }[] };

/**
 * A proposal spends nothing and opens nothing. If any idea or memory behind it came from outside, the
 * venture carries that mark for good, and the desk shows it.
 */
export function proposeVenture(db: DatabaseSync, input: ProposeInput, now: number): Venture {
  ensureVentures(db);
  if (!ID.test(input.id)) throw new Error("ECON_VENTURE_ID");
  if (!(VENTURE_KINDS as readonly string[]).includes(input.kind)) throw new Error("ECON_VENTURE_KIND");
  if (input.by !== "zoora" && input.by !== "owner") throw new Error("ECON_VENTURE_BY");
  const name = clean(input.name, 60);
  if (!name) throw new Error("ECON_VENTURE_NAME");
  const book: BookId = input.kind === "land" ? "land" : "company";
  const added = db
    .prepare("INSERT OR IGNORE INTO econ_ventures(id, book_id, name, kind, pitch, status, proposed_by, created_at) VALUES(?, ?, ?, ?, ?, 'proposed', ?, ?)")
    .run(input.id, book, name, input.kind, clean(input.pitch ?? "", 400), input.by, now);
  if (Number(added.changes) !== 1) throw new Error("ECON_VENTURE_EXISTS");
  if (input.behind?.length) inheritTaint(db, input.behind, { kind: "venture", ref: input.id }, now);
  return getVenture(db, input.id)!;
}

function activeCount(db: DatabaseSync): number {
  return Number((db.prepare("SELECT COUNT(*) AS n FROM econ_ventures WHERE status = 'active'").get() as { n: number }).n);
}

/**
 * The owner's decision. An approval sets what the venture may lose and how long it has. On the earned
 * ladder the budget and the number of ventures running at once are held to what the ladder grants.
 */
export function decideVenture(db: DatabaseSync, id: string, decision: "approved" | "declined", terms: { budgetCents: number; days: number }, now: number): Venture {
  ensureVentures(db);
  const venture = getVenture(db, id);
  if (!venture || venture.status !== "proposed") throw new Error("ECON_VENTURE_STATE");
  if (decision === "declined") {
    db.prepare("UPDATE econ_ventures SET status = 'declined', decided_at = ? WHERE id = ? AND status = 'proposed'").run(now, id);
    return getVenture(db, id)!;
  }
  if (decision !== "approved") throw new Error("ECON_DECISION");
  if (!Number.isSafeInteger(terms.budgetCents) || terms.budgetCents < 0 || terms.budgetCents > MAX_CENTS) throw new Error("ECON_AMOUNT");
  if (!Number.isInteger(terms.days) || terms.days < 1 || terms.days > MAX_VENTURE_DAYS) throw new Error("ECON_VENTURE_DAYS");
  const caps = currentCaps(db, now);
  if (activeCount(db) >= caps.earningVenues) throw new Error("ECON_VENTURE_LIMIT");
  if (ladderMode(db) === "earned" && terms.budgetCents > caps.ventureCents) throw new Error("ECON_VENTURE_CAP");
  db.prepare("UPDATE econ_ventures SET status = 'active', budget_cents = ?, deadline_ms = ?, decided_at = ? WHERE id = ? AND status = 'proposed'").run(terms.budgetCents, now + terms.days * 86_400_000, now, id);
  return getVenture(db, id)!;
}

/** Pause, resume or close. Resuming a venture whose time is up needs a new time limit. */
export function setVentureStatus(db: DatabaseSync, id: string, to: "active" | "paused" | "closed", now: number, extra?: { days?: number; note?: string }): Venture {
  ensureVentures(db);
  const venture = getVenture(db, id);
  if (!venture || !["active", "paused"].includes(venture.status)) throw new Error("ECON_VENTURE_STATE");
  let deadline = venture.deadlineMs;
  if (to === "active") {
    if (extra?.days != null) {
      if (!Number.isInteger(extra.days) || extra.days < 1 || extra.days > MAX_VENTURE_DAYS) throw new Error("ECON_VENTURE_DAYS");
      deadline = now + extra.days * 86_400_000;
    }
    if (deadline == null || deadline <= now) throw new Error("ECON_VENTURE_DAYS");
    if (venture.status !== "active" && activeCount(db) >= currentCaps(db, now).earningVenues) throw new Error("ECON_VENTURE_LIMIT");
  }
  db.prepare("UPDATE econ_ventures SET status = ?, deadline_ms = ?, note = ? WHERE id = ?").run(to, deadline, clean(extra?.note ?? venture.note, 160), id);
  return getVenture(db, id)!;
}

/** Called on the engine's hourly beat. A venture past its time limit stops until the owner looks at it. */
export function expireVentures(db: DatabaseSync, now: number): string[] {
  ensureVentures(db);
  const due = (db.prepare("SELECT id FROM econ_ventures WHERE status = 'active' AND deadline_ms IS NOT NULL AND deadline_ms <= ?").all(now) as { id: string }[]).map((row) => row.id);
  for (const id of due) db.prepare("UPDATE econ_ventures SET status = 'paused', note = 'Time limit reached.' WHERE id = ?").run(id);
  return due;
}

function totals(db: DatabaseSync, id: string): { income: number; expense: number } {
  const rows = db.prepare("SELECT kind, SUM(cents) AS total FROM econ_venture_lines WHERE venture_id = ? GROUP BY kind").all(id) as { kind: string; total: number }[];
  let income = 0;
  let expense = 0;
  for (const row of rows) {
    if (row.kind === "income") income += Number(row.total);
    if (row.kind === "expense") expense += Number(row.total);
  }
  return { income, expense };
}

export type SpendCheck = { ok: true } | { ok: false; reason: "UNKNOWN" | "NOT_ACTIVE" | "EXPIRED" | "BUDGET" | "TAINTED" };

/**
 * Asked before a venture spends without the owner. The venture must be running, inside its time, with
 * nothing from outside behind it, and the spend must not take its loss past the budget.
 */
export function ventureSpendAllowed(db: DatabaseSync, id: string, cents: number, now: number): SpendCheck {
  const venture = getVenture(db, id);
  if (!venture) return { ok: false, reason: "UNKNOWN" };
  if (venture.status !== "active") return { ok: false, reason: "NOT_ACTIVE" };
  if (venture.deadlineMs == null || venture.deadlineMs <= now) return { ok: false, reason: "EXPIRED" };
  if (!untainted(db, [{ kind: "venture", ref: id }]).ok) return { ok: false, reason: "TAINTED" };
  if (!Number.isSafeInteger(cents) || cents < 0) return { ok: false, reason: "BUDGET" };
  const sums = totals(db, id);
  if (sums.expense + cents - sums.income > venture.budgetCents) return { ok: false, reason: "BUDGET" };
  return { ok: true };
}

export type VentureLine = { kind: "income" | "expense"; cents: number; category: string; memo?: string; paidFrom?: string; idem: string };

/** One line in the venture's book and on its scorecard. The same `idem` twice is one line. */
export function ventureLine(db: DatabaseSync, id: string, line: VentureLine, now: number): { added: boolean } {
  const venture = getVenture(db, id);
  if (!venture) throw new Error("ECON_VENTURE_UNKNOWN");
  if (line.kind !== "income" && line.kind !== "expense") throw new Error("ECON_ENTRY_KIND");
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = addEntry(db, { bookId: venture.bookId, kind: line.kind, cents: line.cents, category: line.category, memo: line.memo, paidFrom: line.paidFrom, idem: line.idem }, now);
    if (result.added) db.prepare("INSERT INTO econ_venture_lines(idem, venture_id, kind, cents, at_ms) VALUES(?, ?, ?, ?, ?)").run(line.idem, id, line.kind, line.cents, now);
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export type Scorecard = {
  ventureId: string;
  incomeCents: number;
  expenseCents: number;
  netCents: number;
  /** What it may still lose before it cannot spend. */
  budgetLeftCents: number;
  daysLeft: number | null;
  /** Net over what was spent, in percent. Null until something has been spent. */
  returnPercent: number | null;
  tainted: boolean;
};

export function scorecard(db: DatabaseSync, id: string, now: number): Scorecard {
  const venture = getVenture(db, id);
  if (!venture) throw new Error("ECON_VENTURE_UNKNOWN");
  const sums = totals(db, id);
  const net = sums.income - sums.expense;
  return {
    ventureId: id,
    incomeCents: sums.income,
    expenseCents: sums.expense,
    netCents: net,
    budgetLeftCents: Math.max(0, venture.budgetCents + net),
    daysLeft: venture.deadlineMs == null ? null : Math.max(0, Math.ceil((venture.deadlineMs - now) / 86_400_000)),
    returnPercent: sums.expense > 0 ? Math.round((net / sums.expense) * 100) : null,
    tainted: !untainted(db, [{ kind: "venture", ref: id }]).ok,
  };
}
