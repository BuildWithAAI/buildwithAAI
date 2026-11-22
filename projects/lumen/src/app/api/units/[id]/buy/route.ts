import { clientAddress } from "../../../../../auth/owner";
import { publicModeOn } from "../../../../../auth/publicMode";
import { allowRate } from "../../../../../db/db";
import { getEngine } from "../../../../../server/engine";
import { quoteUnit } from "../../../../../world/unitPay";

export const dynamic = "force-dynamic";

/** Asks to buy a unit. The answer says how much SOL to pay, to which wallet, and the reference the payment must carry. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const engine = getEngine();
  const now = Date.now();
  const ip = clientAddress((name) => request.headers.get(name), process.env.LUMEN_TRUSTED_PROXY, publicModeOn());
  // Each quote reads a price over the network and holds the unit for up to ten minutes. Both are bounded per address and overall.
  if (!allowRate(engine.db, `unit-quote:${ip}`, 4, 60_000, now) || !allowRate(engine.db, "unit-quote:all", 60, 60_000, now)) return Response.json({ ok: false, reason: "RATE_LIMIT" }, { status: 429 });
  if (!/^forge-[0-9a-f]{10}-[hs]\d{1,3}-\d{1,3}$/.test(id)) return Response.json({ ok: false, reason: "UNKNOWN" }, { status: 404 });
  const quote = await quoteUnit(engine.db, engine.env, id, now);
  return Response.json(quote, { status: quote.ok ? 200 : quote.reason === "UNKNOWN" ? 404 : 409, headers: { "Cache-Control": "no-store" } });
}
