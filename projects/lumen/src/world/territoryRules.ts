/** Zoora's claim. Pure rules: no database and no payments. */

/** Chebyshev radius around chunk 0,0. 16 covers x and y from -16 through 16, a 33 by 33 block. */
export const CLAIM_START_RADIUS = 16;

/** Chunks outside the claim, and inside this ring, where nobody else may claim or build. */
export const CLAIM_BUFFER = 8;

/** How many chunks of radius Zoora may add on one Chicago day. */
export const CLAIM_GROW_PER_DAY = 4;

/**
 * Optional owner ceiling. Unset means Zoora chooses the size, still within the daily cap.
 * A missing or invalid value does not invent a maximum.
 */
export function claimCeiling(env: Record<string, string | undefined> = process.env): number | null {
  const raw = env.LUMEN_CLAIM_CEILING?.trim() ?? "";
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  if (value < CLAIM_START_RADIUS) return null;
  return value;
}

export type Zone = "claim" | "buffer" | "open";

export function homeDistance(cx: number, cy: number): number {
  return Math.max(Math.abs(cx), Math.abs(cy));
}

export function zoneAt(cx: number, cy: number, radius: number): Zone {
  const distance = homeDistance(cx, cy);
  if (distance <= radius) return "claim";
  if (distance <= radius + CLAIM_BUFFER) return "buffer";
  return "open";
}

/** Future plots have to start in the open. The claim and the buffer are closed to them. */
export function plotMayStart(cx: number, cy: number, radius = CLAIM_START_RADIUS): { ok: true } | { ok: false; reason: "CLAIM" | "BUFFER" } {
  const zone = zoneAt(cx, cy, radius);
  if (zone === "claim") return { ok: false, reason: "CLAIM" };
  if (zone === "buffer") return { ok: false, reason: "BUFFER" };
  return { ok: true };
}

export function claimSpan(radius: number): number {
  return radius * 2 + 1;
}
