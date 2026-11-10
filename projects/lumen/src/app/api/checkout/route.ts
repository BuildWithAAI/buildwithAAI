import { OWNER_COOKIE, readCookie, safeEqual, sessionValid } from "../../../auth/owner";
import { getEngine } from "../../../server/engine";
import { listPending } from "../../../money/checkoutQueue";

export const dynamic = "force-dynamic";

function keeperOk(request: Request): boolean {
  const engine = getEngine();
  const header = request.headers.get("authorization") ?? "";
  const token = /^Bearer\s+(\S+)$/i.exec(header)?.[1] ?? "";
  const expected = engine.env.OWNER_ACCESS_TOKEN ?? "";
  if (token && expected && safeEqual(token, expected)) return true;
  return sessionValid(engine.db, readCookie(request.headers.get("cookie"), OWNER_COOKIE), Date.now());
}

export function GET(request: Request) {
  if (!keeperOk(request)) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  return Response.json({ pending: listPending(getEngine().db, Date.now()) });
}
