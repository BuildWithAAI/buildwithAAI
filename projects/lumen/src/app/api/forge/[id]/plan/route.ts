import { plansOf } from "../../../../../forge/store";
import { getEngine } from "../../../../../server/engine";

export const dynamic = "force-dynamic";

/** How a build can be walked into: each building's floors, door and stairs, in the build's own metres. Only standing builds are served. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^forge-[0-9a-f]{10}$/.test(id)) return new Response("Not found", { status: 404 });
  let plans: ReturnType<typeof plansOf>;
  try {
    plans = plansOf(getEngine().db, id);
  } catch {
    return new Response("Not ready", { status: 503 });
  }
  if (!plans) return new Response("Not found", { status: 404 });
  return Response.json({ buildings: plans }, { headers: { "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" } });
}
