import { clientAddress } from "../../../../../auth/owner";
import { publicModeOn } from "../../../../../auth/publicMode";
import { allowRate } from "../../../../../db/db";
import { chainTimeMs, fetchFinalized, verifySolPayment } from "../../../../../money/solana";
import { getEngine } from "../../../../../server/engine";
import { orderIsFor } from "../../../../../world/unitPay";
import { getUnit } from "../../../../../world/units";

export const dynamic = "force-dynamic";

/** Says a quote has been paid, and with which transaction. The transaction is read from the chain, and the unit is handed over only if it checks out. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const engine = getEngine();
  const now = Date.now();
  const ip = clientAddress((name) => request.headers.get(name), process.env.LUMEN_TRUSTED_PROXY, publicModeOn());
  // Each check spends one RPC call on a signature the caller chose. Both are bounded per address and overall.
  if (!allowRate(engine.db, `unit-paid:${ip}`, 10, 60_000, now) || !allowRate(engine.db, "unit-paid:all", 120, 60_000, now)) return Response.json({ ok: false, reason: "RATE_LIMIT" }, { status: 429 });
  let order = "";
  let signature = "";
  try {
    const body = (await request.json()) as { order?: unknown; signature?: unknown };
    order = typeof body.order === "string" ? body.order.slice(0, 40) : "";
    signature = typeof body.signature === "string" ? body.signature.trim().slice(0, 100) : "";
  } catch {
    return Response.json({ ok: false, reason: "BODY" }, { status: 400 });
  }
  if (!orderIsFor(engine.db, order, id)) return Response.json({ ok: false, reason: "MISSING" }, { status: 404 });
  const rpc = engine.env.LUMEN_SOL_RPC_URL ?? "";
  const tx = rpc ? await fetchFinalized(rpc, signature) : null;
  const result = verifySolPayment(engine.db, order, signature, tx, Date.now(), { txTime: chainTimeMs(tx) }, engine.env);
  if (!result.ok) return Response.json({ ok: false, reason: result.reason }, { status: 409, headers: { "Cache-Control": "no-store" } });
  const unit = getUnit(engine.db, id);
  return Response.json({ ok: true, unit: unit ? { id: unit.id, address: unit.address, holder: unit.holder, paidCents: unit.agreedCents } : null }, { headers: { "Cache-Control": "no-store" } });
}
