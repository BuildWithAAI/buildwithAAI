import { logSecurity } from "../http/log";

const WINDOW_MS = 60_000;
const LIMIT = 120;
export const PAGE_PRUNE_MS = 5 * 60_000;
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
  hits.set(ip, recent);
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
