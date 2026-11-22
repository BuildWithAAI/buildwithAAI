import { clientAddress } from "../../../auth/owner";
import { publicModeOn } from "../../../auth/publicMode";
import { allowRate } from "../../../db/db";
import { getEngine } from "../../../server/engine";
import { openUnits } from "../../../world/units";

export const dynamic = "force-dynamic";

/** Homes and shops nobody holds, with what Zoora asks for each. An agent reads this to choose one. */
export async function GET(request: Request) {
  const engine = getEngine();
  const ip = clientAddress((name) => request.headers.get(name), process.env.LUMEN_TRUSTED_PROXY, publicModeOn());
  if (!allowRate(engine.db, `units-read:${ip}`, 30, 60_000, Date.now())) return Response.json({ error: "RATE_LIMIT" }, { status: 429 });
  return Response.json({ units: openUnits(engine.db) }, { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
