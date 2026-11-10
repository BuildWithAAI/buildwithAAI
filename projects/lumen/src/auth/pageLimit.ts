const WINDOW_MS = 60_000;
const LIMIT = 120;
const hits = new Map<string, number[]>();

export function allowPage(ip: string, now: number, limit = LIMIT): boolean {
  prunePageLimits(now);
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
}

export function limitedPage(): Response {
  return new Response("Too many requests. Wait a minute and try again.", {
    status: 429,
    headers: { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" },
  });
}
