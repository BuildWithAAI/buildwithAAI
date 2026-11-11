import { labelDownload, readDeliveryToken } from "../../../../shop/delivery";
import { shopFile } from "../../../../shop/store";
import { getEngine } from "../../../../server/engine";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const db = getEngine().db;
  const row = readDeliveryToken(db, token, Date.now());
  if (!row) return new Response("Delivery expired or unknown.", { status: 404 });
  const art = db.prepare("SELECT title, svg FROM creations WHERE id = ?").get(row.creationId) as { title: string; svg: string } | undefined;
  if (art) {
    return new Response(labelDownload(art.svg), {
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Content-Disposition": `inline; filename="${art.title.replace(/[^a-z0-9]+/gi, "-")}.svg"`,
        "Content-Security-Policy": "sandbox",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  const file = shopFile(db, row.creationId);
  if (!file) return new Response("Missing piece.", { status: 404 });
  return new Response(labelDownload(file.body), { headers: { "Content-Type": `${file.type}; charset=utf-8`, "Content-Disposition": `inline; filename="${file.title.replace(/[^a-z0-9]+/gi, "-")}.txt"` } });
}
