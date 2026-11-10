import type { DatabaseSync } from "node:sqlite";

/** A paid delivery stays readable until it expires. A kill switch does not hide it. */
export function readDeliveryToken(db: DatabaseSync, token: string, now: number): { creationId: string } | null {
  const row = db.prepare("SELECT creation_id, expires_at FROM deliveries WHERE token = ?").get(token) as { creation_id: string; expires_at: number } | undefined;
  if (!row || row.expires_at < now) return null;
  return { creationId: row.creation_id };
}
