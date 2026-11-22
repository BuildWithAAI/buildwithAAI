import type { DatabaseSync } from "node:sqlite";
import { flag, setFlag } from "../db/db";
import { bookSummary, ensureEconomy } from "./economy";

/**
 * The ladder and the brakes.
 *
 * By default the ladder is open: Zoora may trade, sell and build from day one, her limit is the money in
 * her working venues, and the milestones record how far she has come. The owner can switch it to "earned",
 * where each step waits for an approved milestone. Zoora cannot change the mode or raise a limit.
 *
 * There is no paper trading. In "earned" mode she does not trade at all until the step that opens it.
 *
 * The brakes only ever close. A trading venue that falls far enough from its own high, or a company book
 * that does, stops live trading until the owner clears it at the desk.
 */

export type Caps = {
  /** The most she may spend without asking, in cents. Zero means every purchase waits for the owner. */
  selfSpendCents: number;
  /** There is no paper trading: she trades for real or not at all. */
  trading: "off" | "live";
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
  step(2_500, { earningVenues: 3, selfSpendCents: 1_000, ventureCents: 5_000 }),
  step(5_000, { earningVenues: 3, selfSpendCents: 1_000, ventureCents: 10_000, trading: "live", tradeCents: 5_000, traders: 1 }),
  step(10_000, { earningVenues: 4, selfSpendCents: 2_500, ventureCents: 25_000, trading: "live", tradeCents: 15_000, traders: 2 }),
  step(25_000, { earningVenues: 4, selfSpendCents: 2_500, ventureCents: 50_000, trading: "live", tradeCents: 25_000, traders: 2, landRegistry: true }),
  step(50_000, { earningVenues: 5, selfSpendCents: 5_000, ventureCents: 100_000, trading: "live", tradeCents: 50_000, traders: 2, landRegistry: true, landSales: true }),
  step(100_000, { earningVenues: 6, selfSpendCents: 10_000, ventureCents: 250_000, trading: "live", tradeCents: 100_000, traders: 3, landRegistry: true, landSales: true }),
  step(250_000, { earningVenues: 8, selfSpendCents: 10_000, ventureCents: 500_000, trading: "live", tradeCents: 250_000, traders: 3, landRegistry: true, landSales: true }),
  step(500_000, { earningVenues: 10, selfSpendCents: 25_000, ventureCents: 1_000_000, trading: "live", tradeCents: 500_000, traders: 4, landRegistry: true, landSales: true }),
  step(1_000_000, { earningVenues: 10, selfSpendCents: 25_000, ventureCents: 1_000_000, trading: "live", tradeCents: 500_000, traders: 4, landRegistry: true, landSales: true }),
];

const TRADING_KINDS = ["exchange", "broker", "mt5"];

export type LadderMode = "open" | "earned";

/**
 * How much the ladder holds her back. The owner sets it at the desk.
 *
 * "open" is the default: she may trade, sell and build from day one, and the milestones are a record of
 * how far she has come. Her limit is the money in her working venues. What sits in a cold wallet has no
 * signing path from here, so it is out of her reach in either mode.
 *
 * "earned" makes each step wait for an approved milestone.
 */
export function ladderMode(db: DatabaseSync): LadderMode {
  return flag(db, "econ_ladder_mode", "open") === "earned" ? "earned" : "open";
}

export function setLadderMode(db: DatabaseSync, mode: LadderMode): void {
  if (mode !== "open" && mode !== "earned") throw new Error("ECON_MODE");
  setFlag(db, "econ_ladder_mode", mode);
}

/** Money she can trade with: the latest reading of each company trading venue that was read in the last 7 days. */
export function workingFloat(db: DatabaseSync, now: number): number {
  ensureEconomy(db);
  const rows = db
    .prepare(
      `SELECT r.value_cents AS value_cents, r.at_ms AS at_ms FROM econ_venues v
       JOIN econ_readings r ON r.id = (SELECT MAX(id) FROM econ_readings WHERE venue_id = v.id)
       WHERE v.book_id = 'company' AND v.kind IN (${TRADING_KINDS.map(() => "?").join(",")})`,
    )
    .all(...TRADING_KINDS) as { value_cents: number; at_ms: number }[];
  return rows.filter((row) => now - Number(row.at_ms) <= 7 * 86_400_000).reduce((sum, row) => sum + Number(row.value_cents), 0);
}

const OPEN_VENUES = 100;

/**
 * What she may do now. In open mode everything is open and a live trade may be as large as her working
 * float. In earned mode it is what the highest approved milestone grants.
 */
export function currentCaps(db: DatabaseSync, now: number = Date.now()): Caps {
  ensureEconomy(db);
  if (ladderMode(db) === "open") {
    const float = workingFloat(db, now);
    return { selfSpendCents: float, trading: "live", tradeCents: float, traders: OPEN_VENUES, earningVenues: OPEN_VENUES, ventureCents: float, landRegistry: true, landSales: true };
  }
  const row = db.prepare("SELECT MAX(threshold_cents) AS top FROM econ_milestones WHERE status = 'approved'").get() as { top: number | null };
  if (row.top == null) return { ...BASE_CAPS };
  const top = STEPS.find((item) => item.dollars * 100 === Number(row.top));
  return top ? { ...top.caps } : { ...BASE_CAPS };
}

/**
 * The ladder can lower the self-approve cap a setting gives. It cannot raise it, and with no setting nothing
 * is self-approved. In open mode the setting stands as the owner wrote it.
 */
export function ladderAutoCap(db: DatabaseSync, settingCents: number | null): number | null {
  if (ladderMode(db) === "open") return settingCents;
  const ladder = currentCaps(db).selfSpendCents;
  if (settingCents == null || ladder <= 0) return null;
  return Math.min(settingCents, ladder);
}

export const VENUE_BRAKE = 0.2;
export const BOOK_BRAKE = 0.3;

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

/** Asked before any trade. Every trade is a real one. */
export function liveTradeAllowed(db: DatabaseSync, usdCents: number, now: number = Date.now()): LiveTradeCheck {
  if (flag(db, "econ_brake") === "1") return { ok: false, reason: "BRAKE" };
  const caps = currentCaps(db, now);
  if (caps.trading !== "live") return { ok: false, reason: "LADDER" };
  if (usdCents > caps.tradeCents) return { ok: false, reason: "LADDER_CAP" };
  return { ok: true };
}
