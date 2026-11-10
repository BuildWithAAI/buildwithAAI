const lastRateLog = new Map<string, number>();

/** One JSON line. No request bodies, tokens, notes, or addresses. A 429 for the same route is logged at most once every 10 seconds. */
export function logSecurity(event: { event: string; status: number; route: string }): void {
  if (event.status === 429) {
    const now = Date.now();
    const previous = lastRateLog.get(event.route) ?? 0;
    if (now - previous < 10_000) return;
    lastRateLog.set(event.route, now);
  }
  console.log(JSON.stringify({ ts: new Date().toISOString(), event: event.event, status: event.status, route: event.route }));
}
