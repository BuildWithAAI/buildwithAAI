import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { moderateNote } from "../brain/social";
import { setFlag } from "../db/db";
import { CHUNK_COORD_LIMIT, worldToChunk } from "./chunkMath";
import {
  appendChunkEdit,
  claimRadius,
  chunkIsPrivate,
  grownToday,
  territoryDay,
  territoryFrozen,
} from "./chunkEdits";
import { CLAIM_BUFFER, CLAIM_GROW_PER_DAY, CLAIM_START_RADIUS, claimCeiling, claimSpan } from "./territoryRules";

export { chunkIsPrivate };

export type TerritoryDesk = {
  radius: number;
  buffer: number;
  span: number;
  frozen: boolean;
  grownToday: number;
};

export function territoryDesk(db: DatabaseSync, now = Date.now()): TerritoryDesk {
  const radius = claimRadius(db);
  return {
    radius,
    buffer: CLAIM_BUFFER,
    span: claimSpan(radius),
    frozen: territoryFrozen(db),
    grownToday: grownToday(db, now),
  };
}

/** Owner desk only. This is not a visitor route. */
export function setTerritoryFrozen(db: DatabaseSync, on: boolean): void {
  setFlag(db, "territory_frozen", on ? "1" : "0");
}

export type GrowthProvenance = { who: "zoora" | "owner"; what: string };

export function expandClaim(
  db: DatabaseSync,
  reason: string,
  step: number,
  now: number,
  provenance?: GrowthProvenance,
): { ok: true; radius: number } | { ok: false; reason: string } {
  const clean = moderateNote(reason, 200);
  if (!clean.ok || !clean.note) return { ok: false, reason: clean.ok ? "REASON" : clean.reason };
  if (!Number.isInteger(step) || step < 1 || step > CLAIM_GROW_PER_DAY) return { ok: false, reason: "STEP" };
  const from = claimRadius(db);
  const ceiling = claimCeiling();
  const cap = ceiling == null ? CHUNK_COORD_LIMIT : Math.min(CHUNK_COORD_LIMIT, ceiling);
  const to = Math.min(from + step, cap);
  if (to <= from) return { ok: false, reason: ceiling != null && from >= ceiling && ceiling < CHUNK_COORD_LIMIT ? "CEILING" : "EDGE" };
  const day = territoryDay(Date.now());
  try {
    appendChunkEdit(db, {
      id: `edit-expand-${from}-${to}-${now}`,
      atMs: now,
      chunkX: 0,
      chunkY: 0,
      tileX: 0,
      tileY: 0,
      kind: "expand",
      payload: { from, to, reason: clean.note, ...(provenance ? { provenance } : {}) },
      actor: "zoora",
      idempotencyKey: `expand:${day}:${from}:${to}`,
    });
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "EXPAND" };
  }
  return { ok: true, radius: to };
}

/** Radius before the latest growth, after earlier vetoes have been applied. */
export function priorClaimRadius(db: DatabaseSync): number {
  const rows = db.prepare("SELECT payload FROM chunk_edits WHERE kind = 'expand' ORDER BY seq ASC").all() as { payload: string }[];
  const stack = [CLAIM_START_RADIUS];
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.payload) as { to?: unknown };
      if (typeof parsed.to !== "number" || !Number.isInteger(parsed.to)) continue;
      if (parsed.to > stack[stack.length - 1]!) stack.push(parsed.to);
      else while (stack.length > 1 && stack[stack.length - 1]! > parsed.to) stack.pop();
    } catch {
      /* a bad row does not move the stack */
    }
  }
  return stack.length > 1 ? stack[stack.length - 2]! : CLAIM_START_RADIUS;
}

/**
 * The keeper sets the claim back. With no target, that is one growth step.
 * A target radius can cross several steps. Each call appends one chain row.
 */
export function vetoGrowth(db: DatabaseSync, now: number, toRadius?: number): { ok: true; radius: number } | { ok: false; reason: string } {
  const radius = claimRadius(db);
  if (radius <= CLAIM_START_RADIUS) return { ok: false, reason: "NONE" };
  const target = toRadius ?? priorClaimRadius(db);
  if (!Number.isInteger(target) || target < CLAIM_START_RADIUS || target >= radius) return { ok: false, reason: "VETO" };
  try {
    appendChunkEdit(db, {
      id: `edit-veto-${radius}-${target}-${now}`,
      atMs: now,
      chunkX: 0,
      chunkY: 0,
      tileX: 0,
      tileY: 0,
      kind: "expand",
      payload: {
        from: radius,
        to: target,
        reason: `The keeper set the claim back to radius ${target}.`,
        provenance: { who: "owner", what: "claim-veto" },
      },
      actor: "owner",
      idempotencyKey: `veto:${territoryDay(Date.now())}:${radius}:${target}:${now}`,
    });
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "VETO" };
  }
  return { ok: true, radius: target };
}

export function setChunkPrivacy(
  db: DatabaseSync,
  cx: number,
  cy: number,
  on: boolean,
  reason: string,
  now: number,
): { ok: true } | { ok: false; reason: string } {
  if (on && cx === 0 && cy === 0) return { ok: false, reason: "HOME" };
  if (!on) return { ok: false, reason: "OWNER" };
  const clean = moderateNote(reason, 200);
  if (!clean.ok || !clean.note) return { ok: false, reason: clean.ok ? "REASON" : clean.reason };
  if (chunkIsPrivate(db, cx, cy) === on) return { ok: true };
  try {
    appendChunkEdit(db, {
      id: `edit-privacy-${cx}-${cy}-${on ? "on" : "off"}-${randomBytes(4).toString("hex")}`,
      atMs: now,
      chunkX: cx,
      chunkY: cy,
      tileX: 0,
      tileY: 0,
      kind: "privacy",
      payload: { private: on, reason: clean.note },
      actor: "zoora",
      idempotencyKey: `privacy:${cx}:${cy}:${on ? "on" : "off"}:${now}`,
    });
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "PRIVACY" };
  }
  return { ok: true };
}

/** Owner desk only. Zoora cannot open a chunk she closed, and she cannot close 0,0. */
export function unprivateChunk(
  db: DatabaseSync,
  cx: number,
  cy: number,
  now: number,
): { ok: true } | { ok: false; reason: string } {
  if (!Number.isInteger(cx) || !Number.isInteger(cy)) return { ok: false, reason: "CHUNK" };
  if (!chunkIsPrivate(db, cx, cy)) return { ok: true };
  try {
    appendChunkEdit(db, {
      id: `edit-privacy-${cx}-${cy}-off-${randomBytes(4).toString("hex")}`,
      atMs: now,
      chunkX: cx,
      chunkY: cy,
      tileX: 0,
      tileY: 0,
      kind: "privacy",
      payload: { private: false, reason: "The keeper opened this chunk." },
      actor: "owner",
      idempotencyKey: `privacy:${cx}:${cy}:off:${now}`,
    });
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "PRIVACY" };
  }
  return { ok: true };
}

const GROWTH_REASON_MAX = 200;

/** A fixed sentence. The build's own words are not copied into the claim. */
export function growthReason(emotion: "pride" | "curiosity", step = 1): string {
  const noun = step === 1 ? "chunk" : "chunks";
  return `Zoora grew the claim by ${step} ${noun} while she felt ${emotion}.`.slice(0, GROWTH_REASON_MAX);
}

export type GrowthMemory = {
  text: string;
  provenance: { who: "zoora"; what: "claim-growth" };
};

/** Her own build can grow the claim. A visitor-influenced build cannot. */
export function considerGrowth(
  db: DatabaseSync,
  build: { influenced: boolean; why: string; emotion: string } | null,
  now: number,
): { ok: true; radius: number; memory: GrowthMemory } | { ok: false; reason: string } | null {
  if (!build || build.influenced) return null;
  if (build.emotion !== "pride" && build.emotion !== "curiosity") return null;
  const text = growthReason(build.emotion, 1);
  const grew = expandClaim(db, text, 1, now, { who: "zoora", what: "claim-growth" });
  if (!grew.ok) return grew;
  return {
    ok: true,
    radius: grew.radius,
    memory: { text, provenance: { who: "zoora", what: "claim-growth" } },
  };
}

/** Frustration can close one of her chunks, never the home island. Visitor-influenced work cannot. */
export function considerPrivacy(
  db: DatabaseSync,
  build: { influenced: boolean; emotion: string; x: number; z: number } | null,
  now: number,
): { ok: true } | { ok: false; reason: string } | null {
  if (!build || build.influenced) return null;
  if (build.emotion !== "frustration") return null;
  const spot = worldToChunk(build.x, build.z);
  if (spot.cx === 0 && spot.cy === 0) return null;
  return setChunkPrivacy(db, spot.cx, spot.cy, true, "I want this stretch of water quiet.", now);
}
