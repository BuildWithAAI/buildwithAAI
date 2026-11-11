import { jarvisReadBody, jarvisTokenOk } from "../../../../integrations/jarvis";
import { logSecurity } from "../../../../http/log";
import { getEngine } from "../../../../server/engine";

export const dynamic = "force-dynamic";

function bearer(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1] ?? null;
}

export async function GET(request: Request) {
  if (!jarvisTokenOk(bearer(request), process.env)) return Response.json({ error: "JARVIS_UNAUTHORIZED" }, { status: 401 });
  const view = getEngine().jarvisView();
  if (!view.ok) {
    const status = view.error === "RATE_LIMIT" ? 429 : 400;
    if (status === 429) logSecurity({ event: "rate_limited", status, route: "/api/jarvis/chat" });
    return Response.json({ error: view.error }, { status });
  }
  return Response.json(jarvisReadBody(view));
}

export async function POST(request: Request) {
  if (!jarvisTokenOk(bearer(request), process.env)) return Response.json({ error: "JARVIS_UNAUTHORIZED" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { text?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text : "";
  const result = await getEngine().jarvisTalk(text);
  if (!result.ok) {
    const status = result.error === "RATE_LIMIT" ? 429 : 400;
    if (status === 429) logSecurity({ event: "rate_limited", status, route: "/api/jarvis/chat" });
    return Response.json({ error: result.error }, { status });
  }
  return Response.json({ queued: result.queued, reply: result.reply });
}
