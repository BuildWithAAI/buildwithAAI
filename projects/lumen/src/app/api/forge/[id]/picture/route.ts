import { pictureBytes } from "../../../../../forge/store";
import { getEngine } from "../../../../../server/engine";

export const dynamic = "force-dynamic";

/** A picture of one build, drawn by her own viewport. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^forge-[0-9a-f]{10}$/.test(id)) return new Response("Not found", { status: 404 });
  let bytes: Buffer | null;
  try {
    bytes = pictureBytes(getEngine().db, id);
  } catch {
    return new Response("Not ready", { status: 503 });
  }
  if (!bytes) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" } });
}
