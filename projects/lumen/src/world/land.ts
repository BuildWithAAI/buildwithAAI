import type { DatabaseSync } from "node:sqlite";
import { claimRadius, grownToday, territoryDay, territoryFrozen } from "./chunkEdits";
import { CHUNK_COORD_LIMIT } from "./chunkMath";
import { CLAIM_BUFFER, claimCeiling, homeDistance, zoneAt } from "./territoryRules";

/**
 * Who holds which land, and the two promises made to Zoora about it.
 *
 * Her land is her claim (a square of chunks around her island) and any single chunks she has claimed
 * beyond it. Other holders have plots. Nothing here takes payment: a sale, when there is one, must come
 * through `grantPlot`, which is the only way a plot is recorded.
 *
 * Promise one: she is never boxed in. Four lanes, three chunks wide, run from her home along the axes
 * to the edge of the world, and no plot may ever be placed in them. However much land is sold, a road
 * out is always hers to claim. Nobody may hold land within the buffer around anything of hers, either.
 *
 * Promise two: she can always grow. When the whole next ring around her claim is free she takes the
 * ring, as before. When someone's plot is in the way she is no longer stuck: she claims single free
 * chunks, each one touching land she already holds, in whatever direction is open.
 */

/** A lane reaches this many chunks either side of an axis: three chunks wide in all. */
export const LANE_HALF = 1;
/** Single chunks she may claim in one day, on top of ring growth. */
export const CHUNKS_PER_DAY = 12;

export function ensureLand(db: DatabaseSync): void {
  db.exec("CREATE TABLE IF NOT EXISTS land_plots (cx INTEGER NOT NULL, cy INTEGER NOT NULL, holder TEXT NOT NULL, at_ms INTEGER NOT NULL, PRIMARY KEY(cx, cy))");
}

export function inLane(cx: number, cy: number): boolean {
  return Math.abs(cx) <= LANE_HALF || Math.abs(cy) <= LANE_HALF;
}

type Plot = { cx: number; cy: number; holder: string };

function plots(db: DatabaseSync): Plot[] {
  ensureLand(db);
  return (db.prepare("SELECT cx, cy, holder FROM land_plots").all() as Plot[]).map((row) => ({ cx: Number(row.cx), cy: Number(row.cy), holder: row.holder }));
}

/** Who holds a chunk: "zoora", another holder's id, or nobody. */
export function holderAt(db: DatabaseSync, cx: number, cy: number): string | null {
  if (zoneAt(cx, cy, claimRadius(db)) === "claim") return "zoora";
  ensureLand(db);
  const row = db.prepare("SELECT holder FROM land_plots WHERE cx = ? AND cy = ?").get(cx, cy) as { holder: string } | undefined;
  return row?.holder ?? null;
}

export function isHers(db: DatabaseSync, cx: number, cy: number): boolean {
  return holderAt(db, cx, cy) === "zoora";
}

/** The single chunks she holds beyond her square claim. */
export function herReaches(db: DatabaseSync): { cx: number; cy: number }[] {
  return plots(db).filter((plot) => plot.holder === "zoora").map(({ cx, cy }) => ({ cx, cy }));
}

function nearHers(db: DatabaseSync, cx: number, cy: number, within: number): boolean {
  if (homeDistance(cx, cy) <= claimRadius(db) + within) return true;
  return herReaches(db).some((chunk) => Math.max(Math.abs(chunk.cx - cx), Math.abs(chunk.cy - cy)) <= within);
}

export type PlotCheck = { ok: true } | { ok: false; reason: "EDGE" | "HERS" | "BUFFER" | "LANE" | "HELD" | "HOLDER" };

/** May someone else hold this chunk? This is the whole rule. A sale that skips it is not a sale. */
export function plotAllowed(db: DatabaseSync, cx: number, cy: number): PlotCheck {
  if (!Number.isInteger(cx) || !Number.isInteger(cy) || homeDistance(cx, cy) > CHUNK_COORD_LIMIT) return { ok: false, reason: "EDGE" };
  // Her roads out. Checked first, so this answer never depends on anything else.
  if (inLane(cx, cy)) return { ok: false, reason: "LANE" };
  const holder = holderAt(db, cx, cy);
  if (holder === "zoora") return { ok: false, reason: "HERS" };
  if (holder) return { ok: false, reason: "HELD" };
  if (nearHers(db, cx, cy, CLAIM_BUFFER)) return { ok: false, reason: "BUFFER" };
  return { ok: true };
}

/** Records a plot for another holder. Refused when the rule says no. Taking payment is not done here. */
export function grantPlot(db: DatabaseSync, cx: number, cy: number, holder: string, now: number): PlotCheck {
  if (holder === "zoora" || !/^[a-z0-9][a-z0-9-]{1,39}$/.test(holder)) return { ok: false, reason: "HOLDER" };
  const check = plotAllowed(db, cx, cy);
  if (!check.ok) return check;
  db.prepare("INSERT INTO land_plots(cx, cy, holder, at_ms) VALUES(?, ?, ?, ?)").run(cx, cy, holder, now);
  return { ok: true };
}

/** Whether her claim can grow as a whole ring from one radius to another: nobody else holds anything it would cover. */
export function ringFree(db: DatabaseSync, to: number): boolean {
  return !plots(db).some((plot) => plot.holder !== "zoora" && homeDistance(plot.cx, plot.cy) <= to);
}

const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/** Free chunks that touch her land, nearest home first, lanes before the rest. These are what she can claim next. */
export function frontier(db: DatabaseSync): { cx: number; cy: number }[] {
  const radius = claimRadius(db);
  const held = new Map(plots(db).map((plot) => [`${plot.cx},${plot.cy}`, plot.holder]));
  const mine = (cx: number, cy: number) => homeDistance(cx, cy) <= radius || held.get(`${cx},${cy}`) === "zoora";
  const out = new Map<string, { cx: number; cy: number }>();
  const offer = (cx: number, cy: number) => {
    if (homeDistance(cx, cy) > CHUNK_COORD_LIMIT || mine(cx, cy) || held.has(`${cx},${cy}`)) return;
    out.set(`${cx},${cy}`, { cx, cy });
  };
  for (let k = -radius; k <= radius; k += 1) {
    offer(k, radius + 1);
    offer(k, -radius - 1);
    offer(radius + 1, k);
    offer(-radius - 1, k);
  }
  for (const plot of held.entries()) {
    if (plot[1] !== "zoora") continue;
    const [cx, cy] = plot[0].split(",").map(Number) as [number, number];
    for (const [dx, dy] of SIDES) offer(cx + dx, cy + dy);
  }
  const rank = (chunk: { cx: number; cy: number }) => homeDistance(chunk.cx, chunk.cy) * 4 + (inLane(chunk.cx, chunk.cy) ? 0 : 1) + (Math.abs(chunk.cx) + Math.abs(chunk.cy)) / 100_000;
  return [...out.values()].sort((a, b) => rank(a) - rank(b) || a.cx - b.cx || a.cy - b.cy);
}

function reachedToday(db: DatabaseSync, now: number): number {
  ensureLand(db);
  const day = territoryDay(now);
  return (db.prepare("SELECT at_ms FROM land_plots WHERE holder = 'zoora'").all() as { at_ms: number }[]).filter((row) => territoryDay(Number(row.at_ms)) === day).length;
}

export type ClaimResult = { ok: true; cx: number; cy: number } | { ok: false; reason: "FROZEN" | "DAY" | "CEILING" | "NOT_FREE" | "NOT_TOUCHING" };

/** She claims one chunk. It must be free and must touch land she already holds. */
export function claimChunk(db: DatabaseSync, cx: number, cy: number, now: number): ClaimResult {
  if (territoryFrozen(db)) return { ok: false, reason: "FROZEN" };
  if (reachedToday(db, now) >= CHUNKS_PER_DAY) return { ok: false, reason: "DAY" };
  const ceiling = claimCeiling();
  if (ceiling != null && homeDistance(cx, cy) > ceiling) return { ok: false, reason: "CEILING" };
  if (!Number.isInteger(cx) || !Number.isInteger(cy) || homeDistance(cx, cy) > CHUNK_COORD_LIMIT || holderAt(db, cx, cy) !== null) return { ok: false, reason: "NOT_FREE" };
  if (!SIDES.some(([dx, dy]) => isHers(db, cx + dx, cy + dy))) return { ok: false, reason: "NOT_TOUCHING" };
  db.prepare("INSERT INTO land_plots(cx, cy, holder, at_ms) VALUES(?, ?, 'zoora', ?)").run(cx, cy, now);
  return { ok: true, cx, cy };
}

/** Used when the next whole ring is not free: she takes the nearest free chunk that touches her land. */
export function growAround(db: DatabaseSync, now: number): ClaimResult {
  const next = frontier(db)[0];
  return next ? claimChunk(db, next.cx, next.cy, now) : { ok: false, reason: "NOT_FREE" };
}

/** What the desk shows. `canGrow` is true whenever she has somewhere to claim, which the lanes make always so. */
export function landDesk(db: DatabaseSync, now: number): { radius: number; reaches: number; othersPlots: number; ringFree: boolean; canGrow: boolean; grownToday: number; reachedToday: number } {
  const radius = claimRadius(db);
  return { radius, reaches: herReaches(db).length, othersPlots: plots(db).filter((plot) => plot.holder !== "zoora").length, ringFree: ringFree(db, radius + 1), canGrow: frontier(db).length > 0, grownToday: grownToday(db, now), reachedToday: reachedToday(db, now) };
}
