import { solanaPayBlock } from "../../../../money/solana";
import { shopFile } from "../../../../shop/store";
import { getEngine } from "../../../../server/engine";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const engine = getEngine();
  const db = engine.db;
  if (solanaPayBlock(db, engine.env)) return new Response("Delivery is paused.", { status: 403 });
  const row = db.prepare("SELECT creation_id, expires_at FROM deliveries WHERE token = ?").get(token) as { creation_id: string; expires_at: number } | undefined;
  if (!row || row.expires_at < Date.now()) return new Response("Delivery expired or unknown.", { status: 404 });
  const art = db.prepare("SELECT title, svg FROM creations WHERE id = ?").get(row.creation_id) as { title: string; svg: string } | undefined;
  if (art) return new Response(art.svg, { headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Content-Disposition": `inline; filename="${art.title.replace(/[^a-z0-9]+/gi, "-")}.svg"` } });
  const file = shopFile(db, row.creation_id);
  if (!file) return new Response("Missing piece.", { status: 404 });
  return new Response(file.body, { headers: { "Content-Type": `${file.type}; charset=utf-8`, "Content-Disposition": `inline; filename="${file.title.replace(/[^a-z0-9]+/gi, "-")}.txt"` } });
}
