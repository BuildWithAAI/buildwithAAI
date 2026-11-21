import { parseChunkQuery } from "../../../../../world/chunkMath";
import { readNearby } from "../../../../../world/visitors";
import { bearerToken, visitorDb, visitorResult } from "../../visitorGate";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const gate = visitorDb(request);
  if ("closed" in gate) return gate.closed;
  const url = new URL(request.url);
  const spot = parseChunkQuery(url.searchParams.get("x"), url.searchParams.get("y"));
  if (!spot) return visitorResult(400, { error: "CHUNK" });
  const result = readNearby(gate.db, bearerToken(request), spot.cx, spot.cy, gate.ip, Date.now());
  if (!result.ok) return visitorResult(result.status, { error: result.reason });
  return visitorResult(200, { agents: result.agents });
}
