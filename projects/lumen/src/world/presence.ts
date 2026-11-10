import { bearerAddress } from "../auth/ownerToken";

const WINDOW_MS = 45_000;
const PRUNE_MS = 15_000;
export const PRESENCE_PER_IP = 8;
export const PRESENCE_GLOBAL_CAP = 256;

const beats = new Map<string, { at: number; ip: string }>();
const slotsByIp = new Map<string, string[]>();
let prunedAt = 0;

function drop(ip: string, id: string): void {
  beats.delete(`${ip}\n${id}`);
  const slots = slotsByIp.get(ip);
  if (!slots) return;
  const next = slots.filter((slot) => slot !== id);
  if (next.length) slotsByIp.set(ip, next);
  else slotsByIp.delete(ip);
}

/** Drop expired beats on a timer. A single note does not walk the whole map. */
export function prunePresence(now: number): void {
  for (const [key, beat] of beats) {
    if (now - beat.at <= WINDOW_MS && now >= beat.at) continue;
    const id = key.slice(beat.ip.length + 1);
    drop(beat.ip, id);
  }
}

function maybePrune(now: number): void {
  if (prunedAt !== 0 && now - prunedAt < PRUNE_MS) return;
  prunedAt = now;
  prunePresence(now);
}

/** Remember an anonymous slot. One address can only hold a few slots, so rotating ids cannot inflate the count. */
export function notePresence(slot: string, now: number, ip = "local"): void {
  maybePrune(now);
  const id = slot.replace(/[^a-z0-9]/gi, "").slice(0, 16);
  if (id.length < 8) return;
  const bucket = bearerAddress(ip.trim() || "local");
  const slots = slotsByIp.get(bucket) ?? [];
  const existing = slots.indexOf(id);
  if (existing >= 0) slots.splice(existing, 1);
  slots.push(id);
  while (slots.length > PRESENCE_PER_IP) {
    const gone = slots.shift();
    if (gone) beats.delete(`${bucket}\n${gone}`);
  }
  slotsByIp.set(bucket, slots);
  beats.delete(`${bucket}\n${id}`);
  beats.set(`${bucket}\n${id}`, { at: now, ip: bucket });
  while (beats.size > PRESENCE_GLOBAL_CAP) {
    const oldest = beats.keys().next().value;
    if (oldest === undefined) break;
    const beat = beats.get(oldest);
    beats.delete(oldest);
    if (beat) drop(beat.ip, oldest.slice(beat.ip.length + 1));
  }
}

export function presenceCount(now: number): number {
  let count = 0;
  for (const beat of beats.values()) if (now - beat.at <= WINDOW_MS && now >= beat.at) count += 1;
  return count;
}

export function presenceLevel(now: number): number {
  return Math.min(1, presenceCount(now) / 4);
}

export function presenceSize(): number {
  return beats.size;
}

export function resetPresence(): void {
  beats.clear();
  slotsByIp.clear();
  prunedAt = 0;
}
