import type { DatabaseSync } from "node:sqlite";
import { clientAddress } from "../auth/owner";
import { allowPublicRequest } from "../auth/public";
import { publicModeOn } from "../auth/publicMode";
import { getEngine } from "../server/engine";

export const SNAPSHOT_CACHE_MS = 3_000;

export function remember<T>(slot: { at: number; value: T } | null, now: number, ttlMs: number, load: () => T): { slot: { at: number; value: T }; value: T } {
  if (slot && now - slot.at < ttlMs && now >= slot.at) return { slot, value: slot.value };
  const value = load();
  return { slot: { at: now, value }, value };
}

let snapshotSlot: { at: number; value: ReturnType<ReturnType<typeof getEngine>["snapshot"]> } | null = null;

export function cachedSnapshot(now = Date.now()) {
  const next = remember(snapshotSlot, now, SNAPSHOT_CACHE_MS, () => getEngine().snapshot());
  snapshotSlot = next.slot;
  return next.value;
}

export function resetSnapshotCache(): void {
  snapshotSlot = null;
}

export function publicReadAllowed(db: DatabaseSync, request: Request, now = Date.now()): boolean {
  const ip = clientAddress((name) => request.headers.get(name), process.env.LUMEN_TRUSTED_PROXY, publicModeOn());
  return allowPublicRequest(db, ip, now);
}

export function jsonOrLimited(allowed: boolean, body: unknown): Response {
  if (!allowed) return Response.json({ error: "RATE_LIMIT" }, { status: 429, headers: { "cache-control": "no-store" } });
  return Response.json(body, { headers: { "cache-control": "public, max-age=3" } });
}
