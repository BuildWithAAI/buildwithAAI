import type { DatabaseSync } from "node:sqlite";

/**
 * Zoora's economy. Two sets of books, one treasury per book, and a ladder of milestones.
 *
 * The company book is the business. The land book is the island: plots are a different product,
 * sold on Solana, and it keeps its own accounts. Nothing moves between the books by itself.
 *
 * A balance is a reading. A reading comes from code that asked the venue ("reader") or from the
 * owner ("owner"). Zoora has no way to write one. A milestone is measured from readings, less what
 * the owner put in and less costs paid from outside, so it counts what was earned and not what was deposited.
 *
 * A milestone counts everything Zoora earned for Zoora Technologies: the shop, art, writing, trading and
 * the land. The two books are kept apart, and what each earned is added for the milestone.
 *
 * Reaching a milestone unlocks nothing. It files a request. The owner approves or declines it.
 */

export const MILESTONE_DOLLARS = [500, 1_000, 2_500, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000] as const;
export const BANK_SPLIT = { reserve: 65, hardware: 25, operations: 10 } as const;
export type Bucket = keyof typeof BANK_SPLIT;
export const BOOKS = ["company", "land"] as const;
export type BookId = (typeof BOOKS)[number];
export const VENUE_KINDS = ["exchange", "broker", "mt5", "shop", "wallet", "bank"] as const;
export type VenueKind = (typeof VENUE_KINDS)[number];
export const ENTRY_KINDS = ["income", "expense", "deposit", "withdrawal"] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];
/** A reading older than this is not counted. A venue nobody has read lately is not proof of anything. */
export const STALE_MS = 7 * 86_400_000;
const MAX_CENTS = 1_000_000_000_000;

/** What each milestone is proposed to open. A default only: the owner can change the wording when approving. */
export const LADDER: Record<number, string> = {
  500: "A second way to earn opens.",
  1_000: "A small spend she can approve herself. A first venture budget.",
  2_500: "A third way to earn. A larger venture budget.",
  5_000: "A larger venture budget. Trading opens, one agent, hard capped.",
  10_000: "A fourth way to earn. The hardware bucket may fund phase 1.",
  25_000: "The land registry opens in her own ledger.",
  50_000: "Land sales open on Solana. A fifth way to earn.",
  100_000: "Legal review and a company entity before anything larger.",
  250_000: "Wider budgets across the business, reviewed one by one.",
  500_000: "A second resident may be proposed.",
  1_000_000: "The owner and Zoora write the next ladder.",
};

/** Everything earned for Zoora Technologies: the company book and the land book, added. */
export function totalEarned(db: DatabaseSync, now: number): number {
  return bookSummary(db, "company", now).earnedCents + bookSummary(db, "land", now).earnedCents;
}

export function ensureEconomy(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS econ_venues (
      id TEXT PRIMARY KEY, book_id TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS econ_readings (
      id INTEGER PRIMARY KEY AUTOINCREMENT, venue_id TEXT NOT NULL, at_ms INTEGER NOT NULL,
      value_cents INTEGER NOT NULL, source TEXT NOT NULL, note TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS econ_readings_venue ON econ_readings(venue_id, id);
    CREATE TABLE IF NOT EXISTS econ_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT, book_id TEXT NOT NULL, at_ms INTEGER NOT NULL, kind TEXT NOT NULL,
      cents INTEGER NOT NULL, category TEXT NOT NULL, memo TEXT NOT NULL DEFAULT '',
      paid_from TEXT NOT NULL DEFAULT 'treasury', bucket TEXT NOT NULL DEFAULT 'operations', idem TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS econ_milestones (
      threshold_cents INTEGER PRIMARY KEY, reached_at INTEGER NOT NULL, measure_cents INTEGER NOT NULL,
      status TEXT NOT NULL, decided_at INTEGER, unlock TEXT NOT NULL
    );
  `);
}

function cents(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_CENTS) throw new Error("ECON_AMOUNT");
  return value;
}

function label(text: string, max: number): string {
  const clean = text.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
  // An account number, key or card number does not belong in a name or a memo.
  if (/\d{8,}/.test(clean.replace(/[\s-]/g, ""))) throw new Error("ECON_NUMBER_REFUSED");
  return clean;
}

function isBook(value: string): value is BookId {
  return (BOOKS as readonly string[]).includes(value);
}

export function addVenue(db: DatabaseSync, input: { id: string; bookId: string; name: string; kind: string }, now: number): void {
  ensureEconomy(db);
  if (!/^[a-z0-9-]{2,40}$/.test(input.id)) throw new Error("ECON_VENUE_ID");
  if (!isBook(input.bookId)) throw new Error("ECON_BOOK");
  if (!(VENUE_KINDS as readonly string[]).includes(input.kind)) throw new Error("ECON_VENUE_KIND");
  const name = label(input.name, 60);
  if (!name) throw new Error("ECON_VENUE_NAME");
  db.prepare("INSERT INTO econ_venues(id, book_id, name, kind, created_at) VALUES(?, ?, ?, ?, ?)").run(input.id, input.bookId, name, input.kind, now);
}

export function recordReading(db: DatabaseSync, input: { venueId: string; valueCents: number; source: "reader" | "owner"; note?: string }, now: number): void {
  ensureEconomy(db);
  if (input.source !== "reader" && input.source !== "owner") throw new Error("ECON_SOURCE");
  const venue = db.prepare("SELECT id FROM econ_venues WHERE id = ?").get(input.venueId);
  if (!venue) throw new Error("ECON_VENUE_UNKNOWN");
  db.prepare("INSERT INTO econ_readings(venue_id, at_ms, value_cents, source, note) VALUES(?, ?, ?, ?, ?)").run(input.venueId, now, cents(input.valueCents), input.source, label(input.note ?? "", 120));
}

export type EntryInput = { bookId: string; kind: string; cents: number; category: string; memo?: string; paidFrom?: string; bucket?: string; idem: string };

/** One line in a book. The same `idem` twice is one line, so a retried form or webhook cannot double it. */
export function addEntry(db: DatabaseSync, input: EntryInput, now: number): { added: boolean } {
  ensureEconomy(db);
  if (!isBook(input.bookId)) throw new Error("ECON_BOOK");
  if (!(ENTRY_KINDS as readonly string[]).includes(input.kind)) throw new Error("ECON_ENTRY_KIND");
  const amount = cents(input.cents);
  if (amount === 0) throw new Error("ECON_AMOUNT");
  const paidFrom = input.paidFrom ?? "treasury";
  if (paidFrom !== "treasury" && paidFrom !== "outside") throw new Error("ECON_PAID_FROM");
  const bucket = input.bucket ?? "operations";
  if (!(bucket in BANK_SPLIT)) throw new Error("ECON_BUCKET");
  if (!/^[A-Za-z0-9:_.-]{4,120}$/.test(input.idem)) throw new Error("ECON_IDEM");
  const category = label(input.category, 40);
  if (!category) throw new Error("ECON_CATEGORY");
  const result = db
    .prepare("INSERT OR IGNORE INTO econ_entries(book_id, at_ms, kind, cents, category, memo, paid_from, bucket, idem) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(input.bookId, now, input.kind, amount, category, label(input.memo ?? "", 160), paidFrom, bucket, input.idem);
  return { added: Number(result.changes) === 1 };
}

/** Whole cents. Reserve and hardware are rounded down and operations takes what is left, so the three always add up. */
export function splitIncome(amount: number): Record<Bucket, number> {
  const total = cents(amount);
  const reserve = Math.floor((total * BANK_SPLIT.reserve) / 100);
  const hardware = Math.floor((total * BANK_SPLIT.hardware) / 100);
  return { reserve, hardware, operations: total - reserve - hardware };
}

export type BookSummary = {
  bookId: BookId;
  incomeCents: number;
  expenseCents: number;
  depositCents: number;
  withdrawalCents: number;
  /** Expenses the owner paid from outside the treasury, such as a model bill on a personal card. */
  outsideExpenseCents: number;
  /** Sum of the latest reading of every venue in the book that has been read inside STALE_MS. */
  treasuryCents: number;
  staleVenues: number;
  lastReadingAt: number | null;
  /** Treasury, less what the owner put in, plus what the owner took out, less costs paid from outside. */
  earnedCents: number;
  buckets: Record<Bucket, number>;
  venues: { kind: VenueKind; cents: number }[];
};

export function bookSummary(db: DatabaseSync, bookId: BookId, now: number): BookSummary {
  ensureEconomy(db);
  const sums = db.prepare("SELECT kind, paid_from, bucket, SUM(cents) AS total FROM econ_entries WHERE book_id = ? GROUP BY kind, paid_from, bucket").all(bookId) as { kind: EntryKind; paid_from: string; bucket: Bucket; total: number }[];
  let income = 0;
  let expense = 0;
  let deposit = 0;
  let withdrawal = 0;
  let outside = 0;
  const spent: Record<Bucket, number> = { reserve: 0, hardware: 0, operations: 0 };
  for (const row of sums) {
    const total = Number(row.total);
    if (row.kind === "income") income += total;
    if (row.kind === "deposit") deposit += total;
    if (row.kind === "withdrawal") withdrawal += total;
    if (row.kind === "expense") {
      expense += total;
      spent[row.bucket] += total;
      if (row.paid_from === "outside") outside += total;
    }
  }
  // Each income line is split on its own, so the buckets match what was allocated line by line.
  const buckets: Record<Bucket, number> = { reserve: 0, hardware: 0, operations: 0 };
  const lines = db.prepare("SELECT cents FROM econ_entries WHERE book_id = ? AND kind = 'income'").all(bookId) as { cents: number }[];
  for (const line of lines) {
    const part = splitIncome(Number(line.cents));
    buckets.reserve += part.reserve;
    buckets.hardware += part.hardware;
    buckets.operations += part.operations;
  }
  for (const name of Object.keys(spent) as Bucket[]) buckets[name] -= spent[name];
  const latest = db
    .prepare(
      `SELECT v.kind AS kind, r.value_cents AS value_cents, r.at_ms AS at_ms FROM econ_venues v
       LEFT JOIN econ_readings r ON r.id = (SELECT MAX(id) FROM econ_readings WHERE venue_id = v.id)
       WHERE v.book_id = ?`,
    )
    .all(bookId) as { kind: VenueKind; value_cents: number | null; at_ms: number | null }[];
  let treasury = 0;
  let stale = 0;
  let last: number | null = null;
  const byKind = new Map<VenueKind, number>();
  for (const row of latest) {
    if (row.at_ms == null || row.value_cents == null || now - Number(row.at_ms) > STALE_MS) {
      stale += 1;
      continue;
    }
    treasury += Number(row.value_cents);
    byKind.set(row.kind, (byKind.get(row.kind) ?? 0) + Number(row.value_cents));
    last = Math.max(last ?? 0, Number(row.at_ms));
  }
  return {
    bookId,
    incomeCents: income,
    expenseCents: expense,
    depositCents: deposit,
    withdrawalCents: withdrawal,
    outsideExpenseCents: outside,
    treasuryCents: treasury,
    staleVenues: stale,
    lastReadingAt: last,
    earnedCents: treasury - deposit + withdrawal - outside,
    buckets,
    venues: [...byKind.entries()].map(([kind, value]) => ({ kind, cents: value })).sort((a, b) => b.cents - a.cents),
  };
}

export type MilestoneRow = { thresholdCents: number; status: "ahead" | "reached" | "approved" | "declined"; reachedAt: number | null; decidedAt: number | null; unlock: string };

/**
 * Measured on everything earned, company and land together. A milestone that was reached stays reached if
 * the treasury later falls: the record is that she got there. Nothing is opened here.
 */
export function detectMilestones(db: DatabaseSync, now: number): number[] {
  const earned = totalEarned(db, now);
  const fresh: number[] = [];
  for (const dollars of MILESTONE_DOLLARS) {
    const threshold = dollars * 100;
    if (earned < threshold) break;
    const added = db
      .prepare("INSERT OR IGNORE INTO econ_milestones(threshold_cents, reached_at, measure_cents, status, decided_at, unlock) VALUES(?, ?, ?, 'reached', NULL, ?)")
      .run(threshold, now, earned, LADDER[dollars] ?? "");
    if (Number(added.changes) === 1) fresh.push(threshold);
  }
  return fresh;
}

/** The owner's decision. Only a reached milestone can be decided, and a decision is not made twice. */
export function decideMilestone(db: DatabaseSync, thresholdCents: number, decision: "approved" | "declined", now: number, unlock?: string): boolean {
  ensureEconomy(db);
  if (decision !== "approved" && decision !== "declined") throw new Error("ECON_DECISION");
  const wording = unlock && unlock.trim() ? label(unlock, 200) : null;
  const result = db
    .prepare("UPDATE econ_milestones SET status = ?, decided_at = ?, unlock = COALESCE(?, unlock) WHERE threshold_cents = ? AND status = 'reached'")
    .run(decision, now, wording, thresholdCents);
  return Number(result.changes) === 1;
}

export function milestones(db: DatabaseSync): MilestoneRow[] {
  ensureEconomy(db);
  const rows = new Map(
    (db.prepare("SELECT threshold_cents, reached_at, status, decided_at, unlock FROM econ_milestones").all() as { threshold_cents: number; reached_at: number; status: MilestoneRow["status"]; decided_at: number | null; unlock: string }[]).map((row) => [Number(row.threshold_cents), row]),
  );
  return MILESTONE_DOLLARS.map((dollars) => {
    const row = rows.get(dollars * 100);
    if (!row) return { thresholdCents: dollars * 100, status: "ahead" as const, reachedAt: null, decidedAt: null, unlock: LADDER[dollars] ?? "" };
    return { thresholdCents: dollars * 100, status: row.status, reachedAt: Number(row.reached_at), decidedAt: row.decided_at == null ? null : Number(row.decided_at), unlock: row.unlock };
  });
}

/** What the public proof panel shows. Totals by kind of venue only. No venue names, ids, memos or notes. */
export type Proof = {
  asOf: number;
  /** Company and land together. This is the figure the milestones are measured against. */
  totalEarnedCents: number;
  company: Pick<BookSummary, "treasuryCents" | "earnedCents" | "lastReadingAt" | "staleVenues" | "venues" | "buckets">;
  land: Pick<BookSummary, "treasuryCents" | "earnedCents" | "incomeCents" | "expenseCents" | "lastReadingAt">;
  milestones: Pick<MilestoneRow, "thresholdCents" | "status" | "reachedAt">[];
};

export function proof(db: DatabaseSync, now: number): Proof {
  const company = bookSummary(db, "company", now);
  const land = bookSummary(db, "land", now);
  return {
    asOf: now,
    totalEarnedCents: company.earnedCents + land.earnedCents,
    company: { treasuryCents: company.treasuryCents, earnedCents: company.earnedCents, lastReadingAt: company.lastReadingAt, staleVenues: company.staleVenues, venues: company.venues, buckets: company.buckets },
    land: { treasuryCents: land.treasuryCents, earnedCents: land.earnedCents, incomeCents: land.incomeCents, expenseCents: land.expenseCents, lastReadingAt: land.lastReadingAt },
    milestones: milestones(db).map((row) => ({ thresholdCents: row.thresholdCents, status: row.status, reachedAt: row.reachedAt })),
  };
}

export function listVenues(db: DatabaseSync): { id: string; bookId: string; name: string; kind: string }[] {
  ensureEconomy(db);
  return (db.prepare("SELECT id, book_id, name, kind FROM econ_venues ORDER BY book_id, id").all() as { id: string; book_id: string; name: string; kind: string }[]).map((row) => ({ id: row.id, bookId: row.book_id, name: row.name, kind: row.kind }));
}
