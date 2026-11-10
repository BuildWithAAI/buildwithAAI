import { clientAddress } from "../../../auth/owner";
import { allowPublicRequest } from "../../../auth/public";
import { publicModeOn } from "../../../auth/publicMode";
import { WORLD_MAX_BYTES } from "../../../http/bodyLimit";
import { getEngine } from "../../../server/engine";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > WORLD_MAX_BYTES) return Response.json({ error: "BODY_TOO_LARGE" }, { status: 413 });
  const ip = clientAddress((name) => request.headers.get(name), process.env.LUMEN_TRUSTED_PROXY, publicModeOn());
  const engine = getEngine();
  if (publicModeOn() && !allowPublicRequest(engine.db, ip)) {
    return Response.json({ error: "RATE_LIMIT" }, { status: 429, headers: { "cache-control": "no-store" } });
  }
  const result = engine.worldRead(ip);
  return Response.json(result.body, { status: result.status, headers: { "cache-control": "no-store" } });
}
