import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { moderateNote } from "../brain/social";
import { setFlag } from "../db/db";
import { worldToChunk } from "./chunkMath";
import {
  appendChunkEdit,
  claimRadius,
  chunkIsPrivate,
  grownToday,
  territoryDay,
  territoryFrozen,
} from "./chunkEdits";
import { CLAIM_BUFFER, CLAIM_GROW_PER_DAY, CLAIM_START_RADIUS, claimSpan } from "./territoryRules";

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

export function expandClaim(
  db: DatabaseSync,
  reason: string,
  step: number,
  now: number,
): { ok: true; radius: number } | { ok: false; reason: string } {
  const clean = moderateNote(reason, 200);
  if (!clean.ok || !clean.note) return { ok: false, reason: clean.ok ? "REASON" : clean.reason };
  if (!Number.isInteger(step) || step < 1 || step > CLAIM_GROW_PER_DAY) return { ok: false, reason: "STEP" };
  const from = claimRadius(db);
  const to = from + step;
  try {
    appendChunkEdit(db, {
      id: `edit-expand-${from}-${to}-${now}`,
      atMs: now,
      chunkX: 0,
      chunkY: 0,
      tileX: 0,
      tileY: 0,
      kind: "expand",
      payload: { from, to, reason: clean.note },
      actor: "zoora",
      idempotencyKey: `expand:${territoryDay(now)}:${from}:${to}`,
    });
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "EXPAND" };
  }
  return { ok: true, radius: to };
}

/** The keeper stops the latest growth. The old row stays. A new row sets the radius back. */
export function vetoGrowth(db: DatabaseSync, now: number): { ok: true; radius: number } | { ok: false; reason: string } {
  const radius = claimRadius(db);
  if (radius <= CLAIM_START_RADIUS) return { ok: false, reason: "NONE" };
  const row = db.prepare("SELECT payload FROM chunk_edits WHERE kind = 'expand' ORDER BY seq DESC LIMIT 1").get() as { payload: string } | undefined;
  let from = CLAIM_START_RADIUS;
  try {
    const parsed = JSON.parse(row?.payload ?? "{}") as { from?: unknown; to?: unknown };
    if (parsed.to === radius && typeof parsed.from === "number") from = parsed.from;
  } catch {
    from = CLAIM_START_RADIUS;
  }
  if (from >= radius || from < CLAIM_START_RADIUS) return { ok: false, reason: "VETO" };
  try {
    appendChunkEdit(db, {
      id: `edit-veto-${radius}-${from}-${now}`,
      atMs: now,
      chunkX: 0,
      chunkY: 0,
      tileX: 0,
      tileY: 0,
      kind: "expand",
      payload: { from: radius, to: from, reason: "The keeper kept the claim at this size." },
      actor: "owner",
      idempotencyKey: `veto:${territoryDay(now)}:${radius}:${from}:${now}`,
    });
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "VETO" };
  }
  return { ok: true, radius: from };
}

export function setChunkPrivacy(
  db: DatabaseSync,
  cx: number,
  cy: number,
  on: boolean,
  reason: string,
  now: number,
): { ok: true } | { ok: false; reason: string } {
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

/** Her own build can grow the claim. A visitor-influenced build cannot. */
export function considerGrowth(
  db: DatabaseSync,
  build: { influenced: boolean; why: string; emotion: string } | null,
  now: number,
): { ok: true; radius: number } | { ok: false; reason: string } | null {
  if (!build || build.influenced) return null;
  if (build.emotion !== "pride" && build.emotion !== "curiosity") return null;
  const reason = build.why.trim().slice(0, 200);
  if (!reason) return null;
  return expandClaim(db, reason, 1, now);
}

/** Frustration can close one of her chunks. Visitor-influenced work cannot. */
export function considerPrivacy(
  db: DatabaseSync,
  build: { influenced: boolean; emotion: string; x: number; z: number } | null,
  now: number,
): { ok: true } | { ok: false; reason: string } | null {
  if (!build || build.influenced) return null;
  if (build.emotion !== "frustration") return null;
  const spot = worldToChunk(build.x, build.z);
  return setChunkPrivacy(db, spot.cx, spot.cy, true, "I want this stretch of water quiet.", now);
}
