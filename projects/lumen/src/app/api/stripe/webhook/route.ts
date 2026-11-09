import { getEngine } from "../../../../server/engine";
import { deskNotifier } from "../../../../money/notify";
import { handleStripeWebhook } from "../../../../money/webhook";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const payload = await request.text();
  const signature = request.headers.get("stripe-signature") ?? "";
  const secret = process.env.STRIPE_WEBHOOK_SECRET ?? "";
  const engine = getEngine();
  const result = handleStripeWebhook(engine.db, payload, signature, secret, Date.now(), deskNotifier(engine.db));
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json({ received: true, duplicate: result.duplicate });
}
