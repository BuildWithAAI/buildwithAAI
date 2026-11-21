import { meshBytes } from "../../../../forge/store";
import { getEngine } from "../../../../server/engine";

export const dynamic = "force-dynamic";

/** One build's mesh, as bytes for the world's renderer. Only standing builds are served. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^forge-[0-9a-f]{10}$/.test(id)) return new Response("Not found", { status: 404 });
  let bytes: Buffer | null;
  try {
    bytes = meshBytes(getEngine().db, id);
  } catch {
    return new Response("Not ready", { status: 503 });
  }
  if (!bytes) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "application/octet-stream", "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" } });
}
