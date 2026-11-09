import { getEngine } from "../../../server/engine";

export const dynamic = "force-dynamic";

export function GET() {
  const snap = getEngine().snapshot();
  return Response.json({ ok: true, awake: snap.awake, sales: snap.money.sales, spendOpen: snap.money.spendOpen });
}
