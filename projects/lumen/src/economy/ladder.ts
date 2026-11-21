import type { DatabaseSync } from "node:sqlite";
import { flag, setFlag } from "../db/db";
import { bookSummary, ensureEconomy } from "./economy";

/**
 * The ladder and the brakes.
 *
 * The ladder turns an approved milestone into a limit. The limits are written here, in code. Zoora cannot
 * raise one, and neither can a setting: only the owner approving a milestone moves her up, and a setting
 * can only make a limit tighter. With nothing approved she can propose and nothing more.
 *
 * The brakes only ever close. A trading venue that falls far enough from its own high, or a company book
 * that does, stops live trading until the owner clears it at the desk.
 */

export type Caps = {
  /** The most she may spend without asking, in cents. Zero means every purchase waits for the owner. */
  selfSpendCents: number;
  trading: "off" | "paper" | "live";
  /** The most one live trade may be, in cents. */
  tradeCents: number;
  traders: number;
  /** Ways to earn she may run at once: a shop, prints, writing, land and so on. */
  earningVenues: number;
  /** The most one venture may be given to try an idea, in cents. */
  ventureCents: number;
  landRegistry: boolean;
  landSales: boolean;
};

export const BASE_CAPS: Caps = { selfSpendCents: 0, trading: "off", tradeCents: 0, traders: 0, earningVenues: 1, ventureCents: 0, landRegistry: false, landSales: false };

function step(dollars: number, caps: Partial<Caps>): { dollars: number; caps: Caps } {
  return { dollars, caps: { ...BASE_CAPS, ...caps } };
}

/**
 * What each approved milestone grants across the whole business, not only trading. Each step restates
 * everything it grants, so the highest approved step is the answer.
 */
export const STEPS: { dollars: number; caps: Caps }[] = [
  step(500, { earningVenues: 2 }),
  step(1_000, { earningVenues: 2, selfSpendCents: 1_000, ventureCents: 2_500 }),
  step(2_500, { earningVenues: 3, selfSpendCents: 1_000, ventureCents: 5_000, trading: "paper" }),
  step(5_000, { earningVenues: 3, selfSpendCents: 1_000, ventureCents: 10_000, trading: "live", tradeCents: 5_000, traders: 1 }),
  step(10_000, { earningVenues: 4, selfSpendCents: 2_500, ventureCents: 25_000, trading: "live", tradeCents: 15_000, traders: 2 }),
  step(25_000, { earningVenues: 4, selfSpendCents: 2_500, ventureCents: 50_000, trading: "live", tradeCents: 25_000, traders: 2, landRegistry: true }),
  step(50_000, { earningVenues: 5, selfSpendCents: 5_000, ventureCents: 100_000, trading: "live", tradeCents: 50_000, traders: 2, landRegistry: true, landSales: true }),
  step(100_000, { earningVenues: 6, selfSpendCents: 10_000, ventureCents: 250_000, trading: "live", tradeCents: 100_000, traders: 3, landRegistry: true, landSales: true }),
  step(250_000, { earningVenues: 8, selfSpendCents: 10_000, ventureCents: 500_000, trading: "live", tradeCents: 250_000, traders: 3, landRegistry: true, landSales: true }),
  step(500_000, { earningVenues: 10, selfSpendCents: 25_000, ventureCents: 1_000_000, trading: "live", tradeCents: 500_000, traders: 4, landRegistry: true, landSales: true }),
  step(1_000_000, { earningVenues: 10, selfSpendCents: 25_000, ventureCents: 1_000_000, trading: "live", tradeCents: 500_000, traders: 4, landRegistry: true, landSales: true }),
];

/** The caps of the highest milestone the owner has approved. Reached, declined and skipped steps grant nothing. */
export function currentCaps(db: DatabaseSync): Caps {
  ensureEconomy(db);
  const row = db.prepare("SELECT MAX(threshold_cents) AS top FROM econ_milestones WHERE status = 'approved'").get() as { top: number | null };
  if (row.top == null) return { ...BASE_CAPS };
  const top = STEPS.find((item) => item.dollars * 100 === Number(row.top));
  return top ? { ...top.caps } : { ...BASE_CAPS };
}

/** The ladder can lower the self-approve cap a setting gives. It cannot raise it, and with no setting nothing is self-approved. */
export function ladderAutoCap(db: DatabaseSync, settingCents: number | null): number | null {
  const ladder = currentCaps(db).selfSpendCents;
  if (settingCents == null || ladder <= 0) return null;
  return Math.min(settingCents, ladder);
}

export const VENUE_BRAKE = 0.2;
export const BOOK_BRAKE = 0.3;
const TRADING_KINDS = ["exchange", "broker", "mt5"];

export type Brake = { scope: string; peakCents: number; valueCents: number; trippedAt: number };

function ensureBrakes(db: DatabaseSync): void {
  ensureEconomy(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS econ_peaks (scope TEXT PRIMARY KEY, peak_cents INTEGER NOT NULL, at_ms INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS econ_brakes (scope TEXT PRIMARY KEY, peak_cents INTEGER NOT NULL, value_cents INTEGER NOT NULL, tripped_at INTEGER NOT NULL);
  `);
}

function mark(db: DatabaseSync, scope: string, value: number, limit: number, now: number): Brake | null {
  const row = db.prepare("SELECT peak_cents FROM econ_peaks WHERE scope = ?").get(scope) as { peak_cents: number } | undefined;
  const peak = Math.max(Number(row?.peak_cents ?? 0), value);
  db.prepare("INSERT INTO econ_peaks(scope, peak_cents, at_ms) VALUES(?, ?, ?) ON CONFLICT(scope) DO UPDATE SET peak_cents = excluded.peak_cents, at_ms = excluded.at_ms").run(scope, peak, now);
  if (peak <= 0 || (peak - value) / peak < limit) return null;
  const added = db.prepare("INSERT OR IGNORE INTO econ_brakes(scope, peak_cents, value_cents, tripped_at) VALUES(?, ?, ?, ?)").run(scope, peak, value, now);
  return Number(added.changes) === 1 ? { scope, peakCents: peak, valueCents: value, trippedAt: now } : null;
}

/**
 * Compare each trading venue, and the company book's earned figure, with its own high. Returns the brakes
 * that tripped on this call. The book uses earned, so an owner deposit or withdrawal that is entered in
 * the books does not look like a gain or a loss. A venue that was not read lately is skipped, not judged.
 */
export function checkBrakes(db: DatabaseSync, now: number): Brake[] {
  ensureBrakes(db);
  const tripped: Brake[] = [];
  const venues = db
    .prepare(
      `SELECT v.id AS id, r.value_cents AS value_cents, r.at_ms AS at_ms FROM econ_venues v
       JOIN econ_readings r ON r.id = (SELECT MAX(id) FROM econ_readings WHERE venue_id = v.id)
       WHERE v.book_id = 'company' AND v.kind IN (${TRADING_KINDS.map(() => "?").join(",")})`,
    )
    .all(...TRADING_KINDS) as { id: string; value_cents: number; at_ms: number }[];
  for (const venue of venues) {
    if (now - Number(venue.at_ms) > 7 * 86_400_000) continue;
    const brake = mark(db, `venue:${venue.id}`, Number(venue.value_cents), VENUE_BRAKE, now);
    if (brake) tripped.push(brake);
  }
  const summary = bookSummary(db, "company", now);
  if (summary.lastReadingAt != null) {
    const brake = mark(db, "book:company", Math.max(0, summary.earnedCents + summary.depositCents), BOOK_BRAKE, now);
    if (brake) tripped.push(brake);
  }
  if (tripped.length) setFlag(db, "econ_brake", "1");
  return tripped;
}

export function brakes(db: DatabaseSync): Brake[] {
  ensureBrakes(db);
  return (db.prepare("SELECT scope, peak_cents, value_cents, tripped_at FROM econ_brakes ORDER BY tripped_at").all() as { scope: string; peak_cents: number; value_cents: number; tripped_at: number }[]).map((row) => ({ scope: row.scope, peakCents: Number(row.peak_cents), valueCents: Number(row.value_cents), trippedAt: Number(row.tripped_at) }));
}

/** The owner's call. The high is set back to where the scope stands now, so the same fall does not trip it again. */
export function clearBrake(db: DatabaseSync, scope: string, now: number): boolean {
  ensureBrakes(db);
  const row = db.prepare("SELECT value_cents FROM econ_brakes WHERE scope = ?").get(scope) as { value_cents: number } | undefined;
  if (!row) return false;
  db.prepare("DELETE FROM econ_brakes WHERE scope = ?").run(scope);
  db.prepare("UPDATE econ_peaks SET peak_cents = ?, at_ms = ? WHERE scope = ?").run(Number(row.value_cents), now, scope);
  const left = db.prepare("SELECT COUNT(*) AS n FROM econ_brakes").get() as { n: number };
  if (Number(left.n) === 0) setFlag(db, "econ_brake", "0");
  return true;
}

export type LiveTradeCheck = { ok: true } | { ok: false; reason: "LADDER" | "LADDER_CAP" | "BRAKE" };

/** Asked before any live trade. Paper trading does not come through here. */
export function liveTradeAllowed(db: DatabaseSync, usdCents: number): LiveTradeCheck {
  if (flag(db, "econ_brake") === "1") return { ok: false, reason: "BRAKE" };
  const caps = currentCaps(db);
  if (caps.trading !== "live") return { ok: false, reason: "LADDER" };
  if (usdCents > caps.tradeCents) return { ok: false, reason: "LADDER_CAP" };
  return { ok: true };
}
