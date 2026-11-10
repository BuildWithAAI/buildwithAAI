const WINDOW_MS = 45_000;
const beats = new Map<string, number>();

/** Remember an anonymous slot. The slot is a random browser id, not a name or address. */
export function notePresence(slot: string, now: number): void {
  const id = slot.replace(/[^a-z0-9]/gi, "").slice(0, 16);
  if (id.length < 8) return;
  beats.set(id, now);
  for (const [key, at] of beats) {
    if (now - at > WINDOW_MS) beats.delete(key);
  }
}

export function presenceCount(now: number): number {
  let count = 0;
  for (const at of beats.values()) if (now - at <= WINDOW_MS && now >= at) count += 1;
  return count;
}

export function presenceLevel(now: number): number {
  return Math.min(1, presenceCount(now) / 4);
}

export function resetPresence(): void {
  beats.clear();
}
