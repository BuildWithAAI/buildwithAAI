import { bookPrivacyReport } from "../../../../money/card";
import { checkoutAuth } from "../../checkout/auth";
import { getEngine } from "../../../../server/engine";

export const dynamic = "force-dynamic";

/** The owner posts a Privacy.com charge here. The card number never arrives. */
export async function POST(request: Request) {
  const auth = checkoutAuth(request);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });
  let body: { transactionId?: unknown; merchant?: unknown; amountCents?: unknown; atMs?: unknown };
  try {
    body = await request.json() as typeof body;
  } catch {
    return Response.json({ error: "REPORT" }, { status: 400 });
  }
  const transactionId = typeof body.transactionId === "string" ? body.transactionId : "";
  const merchant = typeof body.merchant === "string" ? body.merchant : "";
  const amountCents = typeof body.amountCents === "number" ? body.amountCents : Number.NaN;
  const booked = bookPrivacyReport(getEngine().db, { transactionId, merchant, amountCents }, Date.now());
  if (!booked.ok) return Response.json({ error: booked.error }, { status: 400 });
  return Response.json({ ok: true, atMs: booked.atMs });
}
