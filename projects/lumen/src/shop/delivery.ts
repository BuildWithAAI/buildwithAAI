import type { DatabaseSync } from "node:sqlite";

/** A paid delivery stays readable until it expires. A kill switch does not hide it. */
export function readDeliveryToken(db: DatabaseSync, token: string, now: number): { creationId: string } | null {
  const row = db.prepare("SELECT creation_id, expires_at FROM deliveries WHERE token = ?").get(token) as { creation_id: string; expires_at: number } | undefined;
  if (!row || row.expires_at < now) return null;
  return { creationId: row.creation_id };
}

/** A refund or a dispute closes a file that was already handed out for this charge. */
export function revokePaidDownload(db: DatabaseSync, chargeId: string, now: number): void {
  if (!chargeId) return;
  const sales = db.prepare("SELECT ref FROM ledger_entries WHERE charge_id = ? AND kind = 'sale'").all(chargeId) as { ref: string | null }[];
  for (const sale of sales) {
    if (!sale.ref) continue;
    db.prepare("UPDATE deliveries SET expires_at = ? WHERE creation_id = ? AND expires_at >= ?").run(now - 1, sale.ref, now);
  }
  const orders = db.prepare("SELECT delivery_token, listing_id FROM shop_orders WHERE charge_id = ?").all(chargeId) as { delivery_token: string | null; listing_id: string }[];
  for (const order of orders) {
    if (order.delivery_token) db.prepare("UPDATE deliveries SET expires_at = ? WHERE token = ?").run(now - 1, order.delivery_token);
    db.prepare("UPDATE deliveries SET expires_at = ? WHERE creation_id = ? AND expires_at >= ?").run(now - 1, order.listing_id, now);
  }
}
