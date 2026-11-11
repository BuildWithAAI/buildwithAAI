import { clientAddress } from "../../../auth/owner";
import { allowPublicRequest } from "../../../auth/public";
import { publicModeOn } from "../../../auth/publicMode";
import { readLimitedText, WORLD_MAX_BYTES } from "../../../http/bodyLimit";
import { logSecurity } from "../../../http/log";
import { getEngine } from "../../../server/engine";

export async function worldPost(op: "join" | "move" | "act" | "leave", request: Request): Promise<Response> {
  const limited = await readLimitedText(request, WORLD_MAX_BYTES);
  if (!limited.ok) return Response.json({ error: "BODY_TOO_LARGE" }, { status: 413 });
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  let body: Record<string, unknown> = {};
  if (limited.text) {
    try {
      const parsed = JSON.parse(limited.text) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
    } catch {
      body = {};
    }
  }
  const ip = clientAddress((name) => request.headers.get(name), process.env.LUMEN_TRUSTED_PROXY, publicModeOn());
  const engine = getEngine();
  if (publicModeOn() && !allowPublicRequest(engine.db, ip)) {
    logSecurity({ event: "rate_limited", status: 429, route: "/api/world" });
    return Response.json({ error: "RATE_LIMIT" }, { status: 429 });
  }
  const result = engine.worldCommand({
    op,
    token: match?.[1] ?? null,
    ip,
    now: Date.now(),
    placeId: typeof body.placeId === "string" ? body.placeId : undefined,
    action: typeof body.action === "string" ? body.action : undefined,
    say: typeof body.say === "string" ? body.say : undefined,
    event: "event" in body ? body.event : undefined,
    weather: "weather" in body ? body.weather : undefined,
    forceEvent: "forceEvent" in body ? body.forceEvent : undefined,
  });
  return Response.json(result.body, { status: result.status, headers: { "cache-control": "no-store" } });
}
