/** One JSON line. No request bodies, tokens, notes, or addresses. */
export function logSecurity(event: { event: string; status: number; route: string }): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event: event.event, status: event.status, route: event.route }));
}
