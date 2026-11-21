import { allowRate } from "../../../../db/db";
import { logSecurity } from "../../../../http/log";
import { clientAddress } from "../../../../auth/owner";
import { publicModeOn } from "../../../../auth/publicMode";
import { getEngine } from "../../../../server/engine";
import { parseChunkQuery } from "../../../../world/chunkMath";
import { publicChunk } from "../../../../world/chunks";
import { worldSeed } from "../../../../world/chunkCache";
import { claimRadius } from "../../../../world/chunkEdits";
import { CLAIM_BUFFER } from "../../../../world/territoryRules";

export const dynamic = "force-dynamic";

/** Public terrain. Visitor registration stays behind LUMEN_VISITORS_ENABLED. This read does not edit the world. */
export function GET(request: Request) {
  const url = new URL(request.url);
  const spot = parseChunkQuery(url.searchParams.get("x"), url.searchParams.get("y"));
  if (!spot) return Response.json({ error: "CHUNK" }, { status: 400, headers: { "cache-control": "no-store" } });
  const engine = getEngine();
  const ip = clientAddress((name) => request.headers.get(name), process.env.LUMEN_TRUSTED_PROXY, publicModeOn());
  const now = Date.now();
  if (!allowRate(engine.db, `chunk-read:${ip}`, 60, 60_000, now)) {
    logSecurity({ event: "rate_limited", status: 429, route: "/api/world/chunk" });
    return Response.json({ error: "RATE_LIMIT" }, { status: 429, headers: { "cache-control": "no-store" } });
  }
  const chunk = publicChunk(engine.db, spot.cx, spot.cy, worldSeed(engine.env));
  return Response.json({
    ...chunk,
    guests: [],
    territory: { radius: claimRadius(engine.db), buffer: CLAIM_BUFFER },
  }, {
    headers: { "cache-control": "no-store" },
  });
}
