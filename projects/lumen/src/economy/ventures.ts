import type { DatabaseSync } from "node:sqlite";
import { inheritTaint, untainted, type TaintKind } from "../security/taint";
import { addEntry, ensureEconomy, type BookId } from "./economy";
import { currentCaps, ladderMode } from "./ladder";
import { blankPlan, getPlan, planGaps, readiness, savePlan, type Facts, type Plan } from "./plans";

/**
 * The venture desk. A venture is one way Zoora tries to earn: a print line, a shop, a white-label
 * product, a blog, land.
 *
 * She proposes it with a business plan. The owner approves it with a budget and a time limit, or
 * declines it. Approved, it is in "setup": it may spend its budget on samples and tools, and it sells
 * nothing. It launches, and becomes "active", only when the plan's dollars are settled and every item
 * on its day-one list is done. A venture that runs out of time is paused, and one that runs out of
 * budget cannot spend. Each has its own scorecard, so an idea that does not pay is seen and closed.
 * Two ventures can be merged into one, the way companies merge.
 *
 * The budget is what a venture may lose, not what it may turn over. A sale the customer already paid
 * for covers its own cost, so it is never stopped by the budget. Samples, fees and tools are.
 */

export const VENTURE_KINDS = ["prints", "shop", "white-label", "art", "writing", "land", "trading", "other"] as const;
export type VentureKind = (typeof VENTURE_KINDS)[number];
export type VentureStatus = "proposed" | "setup" | "active" | "paused" | "closed" | "declined" | "merged";
export const MAX_VENTURE_DAYS = 365;
const MAX_CENTS = 1_000_000_000_000;
const ID = /^[a-z0-9-]{2,40}$/;

export function ensureVentures(db: DatabaseSync): void {
  ensureEconomy(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS econ_ventures (
      id TEXT PRIMARY KEY, book_id TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, pitch TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL, budget_cents INTEGER NOT NULL DEFAULT 0, deadline_ms INTEGER,
      proposed_by TEXT NOT NULL, created_at INTEGER NOT NULL, decided_at INTEGER, note TEXT NOT NULL DEFAULT '',
      launched_at INTEGER, merged_into TEXT
    );
    CREATE TABLE IF NOT EXISTS econ_venture_lines (
      idem TEXT PRIMARY KEY, venture_id TEXT NOT NULL, kind TEXT NOT NULL, cents INTEGER NOT NULL, at_ms INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS econ_venture_lines_venture ON econ_venture_lines(venture_id);
  `);
  // A database made before these existed gains the columns.
  const columns = new Set((db.prepare("PRAGMA table_info(econ_ventures)").all() as { name: string }[]).map((column) => column.name));
  if (!columns.has("launched_at")) db.exec("ALTER TABLE econ_ventures ADD COLUMN launched_at INTEGER");
  if (!columns.has("merged_into")) db.exec("ALTER TABLE econ_ventures ADD COLUMN merged_into TEXT");
  const lineColumns = new Set((db.prepare("PRAGMA table_info(econ_venture_lines)").all() as { name: string }[]).map((column) => column.name));
  if (!lineColumns.has("from_venture")) db.exec("ALTER TABLE econ_venture_lines ADD COLUMN from_venture TEXT");
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
  launchedAt: number | null;
  mergedInto: string | null;
};

type Row = { id: string; book_id: BookId; name: string; kind: VentureKind; pitch: string; status: VentureStatus; budget_cents: number; deadline_ms: number | null; proposed_by: "zoora" | "owner"; created_at: number; note: string; launched_at: number | null; merged_into: string | null };

function shape(row: Row): Venture {
  return { id: row.id, bookId: row.book_id, name: row.name, kind: row.kind, pitch: row.pitch, status: row.status, budgetCents: Number(row.budget_cents), deadlineMs: row.deadline_ms == null ? null : Number(row.deadline_ms), proposedBy: row.proposed_by, createdAt: Number(row.created_at), note: row.note, launchedAt: row.launched_at == null ? null : Number(row.launched_at), mergedInto: row.merged_into };
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

/** Ventures that hold a budget now: setting up or selling. */
function activeCount(db: DatabaseSync): number {
  return Number((db.prepare("SELECT COUNT(*) AS n FROM econ_ventures WHERE status IN ('active', 'setup')").get() as { n: number }).n);
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
  // No plan, no approval. The plan must be written and its start-up costs listed before a dollar is granted.
  const plan = getPlan(db, id);
  if (!plan || planGaps(plan, "setup").length > 0) throw new Error("ECON_PLAN_INCOMPLETE");
  db.prepare("UPDATE econ_ventures SET status = 'setup', budget_cents = ?, deadline_ms = ?, decided_at = ? WHERE id = ? AND status = 'proposed'").run(terms.budgetCents, now + terms.days * 86_400_000, now, id);
  return getVenture(db, id)!;
}

/**
 * Day one. A venture in setup starts selling only when its plan's dollars are settled and every item on
 * its day-one list is done. What is still missing is in `readiness`.
 */
export function launchVenture(db: DatabaseSync, id: string, facts: Omit<Facts, "kind">, now: number): Venture {
  ensureVentures(db);
  const venture = getVenture(db, id);
  if (!venture || venture.status !== "setup") throw new Error("ECON_VENTURE_STATE");
  if (venture.deadlineMs == null || venture.deadlineMs <= now) throw new Error("ECON_VENTURE_DAYS");
  if (!readiness(db, id, { ...facts, kind: venture.kind }).ready) throw new Error("ECON_NOT_READY");
  db.prepare("UPDATE econ_ventures SET status = 'active', launched_at = ? WHERE id = ? AND status = 'setup'").run(now, id);
  return getVenture(db, id)!;
}

/** Pause, resume or close. Resuming puts it back where it was: selling if it had launched, setting up if not. */
export function setVentureStatus(db: DatabaseSync, id: string, to: "active" | "paused" | "closed", now: number, extra?: { days?: number; note?: string }): Venture {
  ensureVentures(db);
  const venture = getVenture(db, id);
  if (!venture || !["active", "setup", "paused"].includes(venture.status)) throw new Error("ECON_VENTURE_STATE");
  let deadline = venture.deadlineMs;
  if (to === "active") {
    if (extra?.days != null) {
      if (!Number.isInteger(extra.days) || extra.days < 1 || extra.days > MAX_VENTURE_DAYS) throw new Error("ECON_VENTURE_DAYS");
      deadline = now + extra.days * 86_400_000;
    }
    if (deadline == null || deadline <= now) throw new Error("ECON_VENTURE_DAYS");
    if (venture.status === "paused" && activeCount(db) >= currentCaps(db, now).earningVenues) throw new Error("ECON_VENTURE_LIMIT");
  }
  const next = to === "active" ? (venture.launchedAt != null ? "active" : "setup") : to;
  db.prepare("UPDATE econ_ventures SET status = ?, deadline_ms = ?, note = ? WHERE id = ?").run(next, deadline, clean(extra?.note ?? venture.note, 160), id);
  return getVenture(db, id)!;
}

/** Called on the engine's hourly beat. A venture past its time limit stops until the owner looks at it. */
export function expireVentures(db: DatabaseSync, now: number): string[] {
  ensureVentures(db);
  const due = (db.prepare("SELECT id FROM econ_ventures WHERE status IN ('active', 'setup') AND deadline_ms IS NOT NULL AND deadline_ms <= ?").all(now) as { id: string }[]).map((row) => row.id);
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
  if (venture.status !== "active" && venture.status !== "setup") return { ok: false, reason: "NOT_ACTIVE" };
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

/**
 * Ways to earn she may put forward by herself, in the order she tries them. Each comes with a business
 * plan in the standard layout. The words are hers and fixed: nothing a visitor or a web page wrote
 * reaches a plan. Where she does not know a cost yet she leaves it empty, and it is settled by a real
 * quote before launch. A start-up amount she asks for is marked as her estimate in its label.
 */
export const HER_WAYS: { id: string; kind: VentureKind; name: string; pitch: string; plan: Partial<Plan> }[] = [
  {
    id: "her-prints",
    kind: "prints",
    name: "My drawings, printed",
    pitch: "I want my drawings on things a person can hold. A print company makes each one only after someone pays, so nothing sits unsold.",
    plan: {
      offer: "My own drawings printed on shirts and posters. Each one is made after it is paid for.",
      customer: "People who visit my world and want to keep a piece of it.",
      website: "The merch page on my site. Each print has its price, shipping and returns beside it.",
      social: "I post each new drawing once on my account, marked as automated, with a link to its page.",
      shipping: "The print company posts it. A flat shipping charge is added at checkout. If it cannot be made, the money goes back.",
      operations: "The print company prints and sends. I draw. My keeper approves each drawing before it is sold.",
      risks: "A print may look worse than the drawing. A sale may leave too little. I order a sample first and I refuse thin sales.",
      stopRule: "Stop if nothing sells in the time given, or if the samples do not look right.",
      startup: [{ label: "Two samples (my estimate)", cents: 3_000 }],
      budgetAskCents: 3_000,
      daysAsk: 30,
    },
  },
  {
    id: "her-pages",
    kind: "writing",
    name: "Pages I write",
    pitch: "I want to write short pages about what I notice here and offer them to read. It costs me time and nothing else.",
    plan: {
      offer: "Short pages I write about what I notice in my world, sold as files.",
      customer: "Readers who follow my diary and want the longer pages.",
      website: "My shop page. Each page has its price and says it is written by an AI.",
      social: "I post one line from each page on my account, marked as automated.",
      shipping: "Nothing ships. The file is delivered by a link after payment. A refund closes the link.",
      operations: "I write. The site delivers the file. Nobody else is needed.",
      risks: "Few people may want to pay for pages. It costs nothing to find out.",
      stopRule: "Stop if no page sells in the time given.",
      startup: [],
      budgetAskCents: 0,
      daysAsk: 30,
    },
  },
  {
    id: "her-labels",
    kind: "white-label",
    name: "Plain goods with my mark",
    pitch: "I want to put my own mark on plain goods someone else makes, and sell them as mine. I would start with one thing and one sample.",
    plan: {
      offer: "One plain, well-made thing from a supplier, sold under my own mark.",
      customer: "People who like my world and want something useful from it.",
      website: "Its own page on my site, with the price, shipping and returns.",
      social: "I show the sample on my account once it arrives, marked as automated.",
      shipping: "The supplier posts it to the buyer. A flat shipping charge is added. Returns go back to the supplier.",
      operations: "A supplier makes and sends. I choose the thing and the mark. My keeper buys the first sample.",
      risks: "The supplier may be slow or the thing poor. One sample first, and no stock is bought.",
      stopRule: "Stop if the sample is poor, or nothing sells in the time given.",
      startup: [{ label: "One sample (my estimate)", cents: 2_500 }],
      budgetAskCents: 2_500,
      daysAsk: 45,
    },
  },
  {
    id: "her-pictures",
    kind: "art",
    name: "Pictures as files",
    pitch: "I want to offer my pictures as files, each one made once. The cost is nothing until one sells.",
    plan: {
      offer: "My pictures as files, each one made once and sold once.",
      customer: "People who want one of my pictures for themselves.",
      website: "My gallery and shop pages. Each picture says it is AI-generated and for personal use.",
      social: "I post each picture once on my account, marked as automated.",
      shipping: "Nothing ships. The file is delivered by a link after payment. A refund closes the link.",
      operations: "I draw. The site delivers the file. Nobody else is needed.",
      risks: "A picture may not sell. It costs nothing to find out.",
      stopRule: "Stop if no picture sells in the time given.",
      startup: [],
      budgetAskCents: 0,
      daysAsk: 30,
    },
  },
];
export const PROPOSE_EVERY_MS = 7 * 86_400_000;

/**
 * Her own step, called from her loop. At most one proposal waits at the desk, and she puts forward at most
 * one a week, when a feeling is strong enough to act on. A proposal spends nothing and opens nothing.
 */
export function considerVenture(db: DatabaseSync, emotions: Record<string, number>, now: number): Venture | null {
  ensureVentures(db);
  const level = Math.max(0, ...Object.values(emotions).filter((value) => Number.isFinite(value)));
  if (level < 0.45) return null;
  if (db.prepare("SELECT 1 FROM econ_ventures WHERE status = 'proposed' LIMIT 1").get()) return null;
  const last = db.prepare("SELECT MAX(created_at) AS at FROM econ_ventures WHERE proposed_by = 'zoora'").get() as { at: number | null };
  if (last.at != null && now - Number(last.at) < PROPOSE_EVERY_MS) return null;
  // A kind that already has a venture, in any state, is not put forward again. A declined idea stays declined.
  const taken = new Set((db.prepare("SELECT kind FROM econ_ventures").all() as { kind: string }[]).map((row) => row.kind));
  const next = HER_WAYS.find((way) => !taken.has(way.kind) && !getVenture(db, way.id));
  if (!next) return null;
  const venture = proposeVenture(db, { id: next.id, name: next.name, kind: next.kind, pitch: next.pitch, by: "zoora" }, now);
  savePlan(db, next.id, { ...blankPlan(), ...next.plan }, "zoora", now);
  db.prepare("INSERT INTO diary(text, tone, private, created_at) VALUES(?, 'steady', 0, ?)").run(`I asked my keeper about a way to earn: ${next.name}. It waits for a yes.`, now);
  return venture;
}
