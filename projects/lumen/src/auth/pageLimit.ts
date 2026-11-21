import { logSecurity } from "../http/log";

const WINDOW_MS = 60_000;
const LIMIT = 120;
export const PAGE_PRUNE_MS = 5 * 60_000;
/** The most addresses kept at once. Past it the oldest entry is dropped, so invented addresses cannot grow the map without end. */
export const PAGE_LIMIT_CAP = 20_000;
const hits = new Map<string, number[]>();
let lastPrune = 0;

export function allowPage(ip: string, now: number, limit = LIMIT): boolean {
  if (lastPrune === 0 || now - lastPrune >= PAGE_PRUNE_MS) {
    prunePageLimits(now);
    lastPrune = now;
  }
  const recent = (hits.get(ip) ?? []).filter((at) => now - at < WINDOW_MS && now >= at);
  if (recent.length >= limit) {
    hits.set(ip, recent);
    return false;
  }
  recent.push(now);
  hits.delete(ip);
  hits.set(ip, recent);
  while (hits.size > PAGE_LIMIT_CAP) {
    const oldest = hits.keys().next().value;
    if (oldest === undefined) break;
    hits.delete(oldest);
  }
  return true;
}

export function pageLimitSize(): number {
  return hits.size;
}

export function prunePageLimits(now: number): void {
  for (const [ip, stamps] of hits) {
    const recent = stamps.filter((at) => now - at < WINDOW_MS && now >= at);
    if (recent.length) hits.set(ip, recent);
    else hits.delete(ip);
  }
}

export function resetPageLimits(): void {
  hits.clear();
  lastPrune = 0;
}

export function limitedPage(): Response {
  logSecurity({ event: "rate_limited", status: 429, route: "page" });
  return new Response("Too many requests. Wait a minute and try again.", {
    status: 429,
    headers: { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" },
  });
}
