import { clientAddress } from "../../../../auth/owner";
import { publicModeOn } from "../../../../auth/publicMode";
import { allowRate } from "../../../../db/db";
import { logSecurity } from "../../../../http/log";
import { getEngine } from "../../../../server/engine";
import { notePresence, presenceCount } from "../../../../world/presence";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const engine = getEngine();
  const ip = clientAddress((name) => request.headers.get(name), process.env.LUMEN_TRUSTED_PROXY, publicModeOn());
  if (!allowRate(engine.db, `here:${ip}`, 30, 60_000, Date.now())) {
    logSecurity({ event: "rate_limited", status: 429, route: "/api/world/here" });
    return Response.json({ error: "RATE_LIMIT" }, { status: 429 });
  }
  let slot = "";
  try {
    const body = (await request.json()) as { slot?: unknown };
    slot = typeof body.slot === "string" ? body.slot : "";
  } catch {
    slot = "";
  }
  if (!/^[a-z0-9]{8,16}$/i.test(slot)) return Response.json({ error: "SLOT" }, { status: 400 });
  const now = Date.now();
  notePresence(slot, now);
  return Response.json({ here: presenceCount(now) });
}
