import type { DatabaseSync } from "node:sqlite";

export const DOWNLOAD_LICENSE = "AI-generated. Licensed for personal use. This is not a transfer of ownership or copyright.";

export function labelDownload(body: string): string {
  if (body.includes(DOWNLOAD_LICENSE)) return body;
  return `<!-- ${DOWNLOAD_LICENSE} -->\n${body}`;
}

/** A paid delivery stays readable until it expires. A kill switch does not hide it. */
export function readDeliveryToken(db: DatabaseSync, token: string, now: number): { creationId: string } | null {
  const row = db.prepare("SELECT creation_id, expires_at FROM deliveries WHERE token = ?").get(token) as { creation_id: string; expires_at: number } | undefined;
  if (!row || row.expires_at < now) return null;
  return { creationId: row.creation_id };
}

export type PaymentRefs = { paymentIntentId?: string | null; chargeId?: string | null };

/** A refund or a dispute closes the file for this payment. Other buyers of the same listing keep theirs. */
export function revokePaidDownload(db: DatabaseSync, refs: PaymentRefs, now: number): void {
  const paymentIntentId = refs.paymentIntentId || "";
  const chargeId = refs.chargeId || "";
  if (!paymentIntentId && !chargeId) return;
  db.prepare(
    `UPDATE deliveries SET expires_at = ? WHERE expires_at >= ? AND (
      (? != '' AND payment_intent_id = ?) OR (? != '' AND charge_id = ?)
    )`,
  ).run(now - 1, now, paymentIntentId, paymentIntentId, chargeId, chargeId);
  const orders = db.prepare(
    `SELECT delivery_token FROM shop_orders WHERE
      (? != '' AND payment_intent_id = ?) OR (? != '' AND charge_id = ?)`,
  ).all(paymentIntentId, paymentIntentId, chargeId, chargeId) as { delivery_token: string | null }[];
  for (const order of orders) {
    if (order.delivery_token) db.prepare("UPDATE deliveries SET expires_at = ? WHERE token = ?").run(now - 1, order.delivery_token);
  }
}
