import { OWNER_COOKIE, readCookie, safeEqual, sessionValid } from "../../../../auth/owner";
import { WORLD_MAX_BYTES, readLimitedText } from "../../../../http/bodyLimit";
import { rejectPan, reportCheckout } from "../../../../money/checkoutQueue";
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
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(limited.text || "{}") as Record<string, unknown>;
  } catch {
    return Response.json({ error: "BAD_JSON" }, { status: 400 });
  }
  if (rejectPan(body)) return Response.json({ error: "PAN_REJECTED" }, { status: 400 });
  const result = reportCheckout(getEngine().db, {
    id: String(body.id ?? ""),
    claimToken: String(body.claimToken ?? ""),
    ok: body.ok === true,
    orderNumber: typeof body.orderNumber === "string" ? body.orderNumber : undefined,
    amountCents: typeof body.amountCents === "number" ? body.amountCents : undefined,
    merchant: typeof body.merchant === "string" ? body.merchant : undefined,
    receipt: typeof body.receipt === "string" ? body.receipt : undefined,
    reason: typeof body.reason === "string" ? body.reason : undefined,
  }, Date.now());
  if (!result.ok) return Response.json({ error: result.reason }, { status: 400 });
  return Response.json({ ok: true });
}
