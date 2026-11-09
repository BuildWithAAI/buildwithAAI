import { jarvisTokenOk } from "../../../../integrations/jarvis";
import { getEngine } from "../../../../server/engine";

export const dynamic = "force-dynamic";

function bearer(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1] ?? null;
}

export async function GET(request: Request) {
  if (!jarvisTokenOk(bearer(request), process.env)) return Response.json({ error: "JARVIS_UNAUTHORIZED" }, { status: 401 });
  const snap = getEngine().snapshot();
  return Response.json({
    chat: snap.chat,
    mood: snap.feeling,
    wants: snap.publicWants,
  });
}

export async function POST(request: Request) {
  if (!jarvisTokenOk(bearer(request), process.env)) return Response.json({ error: "JARVIS_UNAUTHORIZED" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { text?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text : "";
  const result = await getEngine().ownerChat(text);
  if (!result.ok) return Response.json({ error: result.error }, { status: result.error === "RATE_LIMIT" ? 429 : 400 });
  return Response.json({ queued: result.queued, reply: result.reply });
}
