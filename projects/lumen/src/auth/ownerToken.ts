import { createHash } from "node:crypto";

const WINDOW_MS = 60_000;
const LIMIT = 8;
const LOCK_MS = 15 * 60_000;
const FAIL_LIMIT = 5;
const PRUNE_MS = 60_000;
export const DISTINCT_BEARER_LIMIT = 20;
export const OWNER_TOKEN_MAP_CAP = 4_096;
const hits = new Map<string, number[]>();
const failures = new Map<string, number[]>();
const lockedUntil = new Map<string, number>();
const distinctMisses = new Map<string, { keys: Set<string>; until: number }>();
const prefix48Misses = new Map<string, { keys: Set<string>; until: number }>();
let prunedAt = 0;

/** The lockout key is the whole token, not a shared prefix. */
export function ownerTokenKey(token: string): string {
  return `bearer:${createHash("sha256").update(token).digest("hex")}`;
}

/** IPv4 stays as written. IPv6 is expanded, then cut to /64 and /48. Leading zeros and :: match. */
export function bearerNets(ip: string): { prefix64: string; prefix48: string } {
  const groups = expandIpv6(ip);
  if (!groups) {
    const written = ip.trim().toLowerCase();
    return { prefix64: written, prefix48: written };
  }
  return { prefix64: groups.slice(0, 4).join(":"), prefix48: groups.slice(0, 3).join(":") };
}

export function bearerAddress(ip: string): string {
  return bearerNets(ip).prefix64;
}

function expandIpv6(ip: string): string[] | null {
  let lower = ip.trim().toLowerCase();
  const zone = lower.indexOf("%");
  if (zone >= 0) lower = lower.slice(0, zone);
  if (!lower.includes(":") || lower.includes(".")) return null;
  const halves = lower.split("::");
  if (halves.length > 2) return null;
  const read = (part: string) => (/^[0-9a-f]{1,4}$/.test(part) ? String(Number.parseInt(part, 16)) : null);
  const left = halves[0] ? halves[0].split(":").filter((part) => part.length > 0) : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":").filter((part) => part.length > 0) : [];
  const leftN = left.map(read);
  const rightN = right.map(read);
  if (leftN.some((part) => part == null) || rightN.some((part) => part == null)) return null;
  const missing = 8 - left.length - right.length;
  if (missing < 0) return null;
  return [...(leftN as string[]), ...Array(missing).fill("0"), ...(rightN as string[])];
}

export function allowOwnerToken(key: string, now: number): boolean {
  maybePrune(now);
  if ((lockedUntil.get(key) ?? 0) > now) return false;
  const recent = (hits.get(key) ?? []).filter((at) => now - at < WINDOW_MS);
  if (recent.length >= LIMIT) {
    remember(hits, key, recent);
    return false;
  }
  recent.push(now);
  remember(hits, key, recent);
  return true;
}

export function noteOwnerTokenFailure(key: string, now: number): void {
  const recent = (failures.get(key) ?? []).filter((at) => now - at < LOCK_MS);
  recent.push(now);
  const kept = recent.slice(-FAIL_LIMIT);
  remember(failures, key, kept);
  if (kept.length >= FAIL_LIMIT) remember(lockedUntil, key, now + LOCK_MS);
}

export function ownerTokenLocked(key: string, now: number): boolean {
  return (lockedUntil.get(key) ?? 0) > now;
}

/** Many different wrong tokens from one address are refused. The owner's own token is not locked by them. */
export function noteDistinctBearerMiss(ip: string, key: string, now: number): void {
  const nets = bearerNets(ip);
  addDistinctMiss(distinctMisses, nets.prefix64, key, now);
  addDistinctMiss(prefix48Misses, nets.prefix48, key, now);
}

export function distinctBearerBlocked(ip: string, now: number): boolean {
  const nets = bearerNets(ip);
  return distinctBucketBlocked(prefix48Misses, nets.prefix48, now) || distinctBucketBlocked(distinctMisses, nets.prefix64, now);
}

export function ownerTokenLoad(): number {
  return Math.max(hits.size, failures.size, lockedUntil.size, distinctMisses.size, prefix48Misses.size);
}

export function resetOwnerTokens(): void {
  hits.clear();
  failures.clear();
  lockedUntil.clear();
  distinctMisses.clear();
  prefix48Misses.clear();
  prunedAt = 0;
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
  for (const [key, entry] of distinctMisses) {
    if (entry.until <= now) distinctMisses.delete(key);
  }
  for (const [key, entry] of prefix48Misses) {
    if (entry.until <= now) prefix48Misses.delete(key);
  }
}

function addDistinctMiss(map: Map<string, { keys: Set<string>; until: number }>, bucket: string, key: string, now: number): void {
  const current = map.get(bucket);
  const fresh = !current || current.until <= now;
  const keys = fresh ? new Set<string>() : current.keys;
  if (keys.size < DISTINCT_BEARER_LIMIT) keys.add(key);
  remember(map, bucket, { keys, until: now + LOCK_MS });
}

function distinctBucketBlocked(map: Map<string, { keys: Set<string>; until: number }>, bucket: string, now: number): boolean {
  const current = map.get(bucket);
  if (!current || current.until <= now) {
    if (current) map.delete(bucket);
    return false;
  }
  return current.keys.size >= DISTINCT_BEARER_LIMIT;
}

function maybePrune(now: number): void {
  if (prunedAt !== 0 && now - prunedAt < PRUNE_MS) return;
  prunedAt = now;
  pruneOwnerTokens(now);
}

function remember<T>(map: Map<string, T>, key: string, value: T): void {
  if (map.has(key)) map.delete(key);
  map.set(key, value);
  while (map.size > OWNER_TOKEN_MAP_CAP) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}
