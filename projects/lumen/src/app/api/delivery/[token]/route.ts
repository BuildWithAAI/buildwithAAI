import { shopFile } from "../../../../shop/store";
import { getEngine } from "../../../../server/engine";
import type { DatabaseSync } from "node:sqlite";

export const dynamic = "force-dynamic";

/** A paid delivery stays readable. A kill switch stops new sales, not this file. */
export function readDeliveryToken(db: DatabaseSync, token: string, now: number): { creationId: string } | null {
  const row = db.prepare("SELECT creation_id, expires_at FROM deliveries WHERE token = ?").get(token) as { creation_id: string; expires_at: number } | undefined;
  if (!row || row.expires_at < now) return null;
  return { creationId: row.creation_id };
}

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const db = getEngine().db;
  const row = readDeliveryToken(db, token, Date.now());
  if (!row) return new Response("Delivery expired or unknown.", { status: 404 });
  const art = db.prepare("SELECT title, svg FROM creations WHERE id = ?").get(row.creationId) as { title: string; svg: string } | undefined;
  if (art) return new Response(art.svg, { headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Content-Disposition": `inline; filename="${art.title.replace(/[^a-z0-9]+/gi, "-")}.svg"` } });
  const file = shopFile(db, row.creationId);
  if (!file) return new Response("Missing piece.", { status: 404 });
  return new Response(file.body, { headers: { "Content-Type": `${file.type}; charset=utf-8`, "Content-Disposition": `inline; filename="${file.title.replace(/[^a-z0-9]+/gi, "-")}.txt"` } });
}
