import type { DatabaseSync } from "node:sqlite";

/** A paid delivery stays readable until it expires. A kill switch does not hide it. */
export function readDeliveryToken(db: DatabaseSync, token: string, now: number): { creationId: string } | null {
  const row = db.prepare("SELECT creation_id, expires_at FROM deliveries WHERE token = ?").get(token) as { creation_id: string; expires_at: number } | undefined;
  if (!row || row.expires_at < now) return null;
  return { creationId: row.creation_id };
}

/** A refund or a dispute closes the file for this charge. Other buyers of the same listing keep theirs. */
export function revokePaidDownload(db: DatabaseSync, chargeId: string, now: number): void {
  if (!chargeId) return;
  db.prepare("UPDATE deliveries SET expires_at = ? WHERE charge_id = ? AND expires_at >= ?").run(now - 1, chargeId, now);
  const orders = db.prepare("SELECT delivery_token FROM shop_orders WHERE charge_id = ?").all(chargeId) as { delivery_token: string | null }[];
  for (const order of orders) {
    if (order.delivery_token) db.prepare("UPDATE deliveries SET expires_at = ? WHERE token = ?").run(now - 1, order.delivery_token);
  }
}
