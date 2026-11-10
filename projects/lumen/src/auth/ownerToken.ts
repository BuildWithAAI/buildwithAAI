import { createHash } from "node:crypto";

const WINDOW_MS = 60_000;
const LIMIT = 8;
const LOCK_MS = 15 * 60_000;
const FAIL_LIMIT = 5;
const hits = new Map<string, number[]>();
const failures = new Map<string, number[]>();
const lockedUntil = new Map<string, number>();

/** The lockout key is the whole token, not a shared prefix. */
export function ownerTokenKey(token: string): string {
  return `bearer:${createHash("sha256").update(token).digest("hex")}`;
}

export function allowOwnerToken(key: string, now: number): boolean {
  pruneOwnerTokens(now);
  if ((lockedUntil.get(key) ?? 0) > now) return false;
  const recent = (hits.get(key) ?? []).filter((at) => now - at < WINDOW_MS);
  if (recent.length >= LIMIT) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  return true;
}

export function noteOwnerTokenFailure(key: string, now: number): void {
  const recent = (failures.get(key) ?? []).filter((at) => now - at < LOCK_MS);
  recent.push(now);
  failures.set(key, recent);
  if (recent.length >= FAIL_LIMIT) lockedUntil.set(key, now + LOCK_MS);
}

export function ownerTokenLocked(key: string, now: number): boolean {
  return (lockedUntil.get(key) ?? 0) > now;
}

export function resetOwnerTokens(): void {
  hits.clear();
  failures.clear();
  lockedUntil.clear();
}

export function pruneOwnerTokens(now: number): void {
  for (const [key, stamps] of hits) {
    const recent = stamps.filter((at) => now - at < WINDOW_MS);
    if (recent.length) hits.set(key, recent);
    else hits.delete(key);
  }
  for (const [key, stamps] of failures) {
    const recent = stamps.filter((at) => now - at < LOCK_MS);
    if (recent.length) failures.set(key, recent);
    else failures.delete(key);
  }
  for (const [key, until] of lockedUntil) {
    if (until <= now) lockedUntil.delete(key);
  }
}
