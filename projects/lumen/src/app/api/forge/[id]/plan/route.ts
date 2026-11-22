import { planText } from "../../../../../forge/store";
import { getEngine } from "../../../../../server/engine";

export const dynamic = "force-dynamic";

/** How a build can be walked into: each building's floors, her rooms and inside walls, its door and its stairs, in the build's own metres. Only standing builds are served. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^forge-[0-9a-f]{10}$/.test(id)) return new Response("Not found", { status: 404 });
  let plans: string | null;
  try {
    plans = planText(getEngine().db, id);
  } catch {
    return new Response("Not ready", { status: 503 });
  }
  if (!plans) return new Response("Not found", { status: 404 });
  return new Response(plans, { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" } });
}
