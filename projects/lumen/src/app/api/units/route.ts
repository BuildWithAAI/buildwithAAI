import { clientAddress } from "../../../auth/owner";
import { publicModeOn } from "../../../auth/publicMode";
import { allowRate } from "../../../db/db";
import { getEngine } from "../../../server/engine";
import { askOf, openUnits, unitsOf } from "../../../world/units";

export const dynamic = "force-dynamic";

/**
 * Homes and shops nobody holds, with what Zoora asks for each. An agent reads this to choose one.
 * With `?build=` it is every home and shop in one build, taken or not, which is what someone walking
 * through that build is shown. Who holds a unit is not given here.
 */
export async function GET(request: Request) {
  const engine = getEngine();
  const ip = clientAddress((name) => request.headers.get(name), process.env.LUMEN_TRUSTED_PROXY, publicModeOn());
  if (!allowRate(engine.db, `units-read:${ip}`, 30, 60_000, Date.now())) return Response.json({ error: "RATE_LIMIT" }, { status: 429 });
  const build = new URL(request.url).searchParams.get("build");
  if (build !== null) {
    if (!/^forge-[0-9a-f]{10}$/.test(build)) return Response.json({ error: "UNKNOWN" }, { status: 404 });
    const units = unitsOf(engine.db, build).map((unit) => ({ id: unit.id, address: unit.address, kind: unit.kind, floor: unit.floor, status: unit.status, ...askOf(engine.db, unit) }));
    return Response.json({ units }, { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  }
  return Response.json({ units: openUnits(engine.db) }, { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
