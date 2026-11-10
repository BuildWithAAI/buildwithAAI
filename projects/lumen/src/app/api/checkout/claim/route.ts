import { OWNER_COOKIE, readCookie, safeEqual, sessionValid } from "../../../../auth/owner";
import { WORLD_MAX_BYTES, readLimitedText } from "../../../../http/bodyLimit";
import { claimCheckout, listPending } from "../../../../money/checkoutQueue";
import { getEngine } from "../../../../server/engine";

export const dynamic = "force-dynamic";

function keeperOk(request: Request): boolean {
  const engine = getEngine();
  const header = request.headers.get("authorization") ?? "";
  const token = /^Bearer\s+(\S+)$/i.exec(header)?.[1] ?? "";
  const expected = engine.env.OWNER_ACCESS_TOKEN ?? "";
  if (token && expected && safeEqual(token, expected)) return true;
  return sessionValid(engine.db, readCookie(request.headers.get("cookie"), OWNER_COOKIE), Date.now());
}

export async function POST(request: Request) {
  if (!keeperOk(request)) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const limited = await readLimitedText(request, WORLD_MAX_BYTES);
  if (!limited.ok) return Response.json({ error: "BODY_TOO_LARGE" }, { status: 413 });
  let body: { id?: unknown } = {};
  try {
    body = JSON.parse(limited.text || "{}") as { id?: unknown };
  } catch {
    return Response.json({ error: "BAD_JSON" }, { status: 400 });
  }
  const engine = getEngine();
  const id = typeof body.id === "string" && body.id ? body.id : listPending(engine.db, Date.now())[0]?.id;
  if (!id) return Response.json({ error: "MISSING" }, { status: 404 });
  const result = claimCheckout(engine.db, id, Date.now());
  if (!result.ok) return Response.json({ error: result.reason }, { status: 409 });
  return Response.json({ id: result.item.id, claimToken: result.claimToken, merchant: result.item.merchant, maxCents: result.item.maxCents, expiresAt: result.item.expiresAt });
}
