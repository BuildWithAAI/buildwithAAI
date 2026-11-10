import { clientAddress } from "../../../auth/owner";
import { getEngine } from "../../../server/engine";

export async function worldPost(op: "join" | "move" | "act" | "leave", request: Request): Promise<Response> {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const ip = clientAddress((name) => request.headers.get(name), process.env.LUMEN_TRUSTED_PROXY);
  const result = getEngine().worldCommand({
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
