import { clientAddress } from "../../../auth/owner";
import { allowPublicRequest } from "../../../auth/public";
import { publicModeOn } from "../../../auth/publicMode";
import { getEngine } from "../../../server/engine";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const ip = clientAddress((name) => request.headers.get(name), process.env.LUMEN_TRUSTED_PROXY, publicModeOn());
  const engine = getEngine();
  if (publicModeOn() && !allowPublicRequest(engine.db, ip)) {
    return Response.json({ error: "RATE_LIMIT" }, { status: 429, headers: { "cache-control": "no-store" } });
  }
  const result = engine.worldRead(ip);
  return Response.json(result.body, { status: result.status, headers: { "cache-control": "no-store" } });
}
