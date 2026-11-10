import { bookPrivacyCharge } from "../../../../money/card";
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
  const transactionId = typeof body.transactionId === "string" ? body.transactionId.trim() : "";
  const merchant = typeof body.merchant === "string" ? body.merchant.trim() : "";
  const amountCents = body.amountCents;
  if (!transactionId || !merchant || typeof amountCents !== "number" || !Number.isInteger(amountCents) || amountCents === 0) {
    return Response.json({ error: "REPORT" }, { status: 400 });
  }
  const booked = bookPrivacyCharge(getEngine().db, {
    transactionId,
    merchant,
    amountCents,
    atMs: typeof body.atMs === "number" ? body.atMs : Date.now(),
  });
  return Response.json({ ok: booked.booked, matched: booked.matched });
}
