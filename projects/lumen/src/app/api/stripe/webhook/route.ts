import { getEngine } from "../../../../server/engine";
import { buildOwnerNotifier, deskNotifier } from "../../../../money/notify";
import { handleStripeWebhook } from "../../../../money/webhook";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const payload = await request.text();
  const signature = request.headers.get("stripe-signature") ?? "";
  const secret = process.env.STRIPE_WEBHOOK_SECRET ?? "";
  const engine = getEngine();
  const mode = process.env.LUMEN_SALES_MODE;
  const livemode = mode === "live" ? true : mode === "test" ? false : undefined;
  const result = handleStripeWebhook(engine.db, payload, signature, secret, Date.now(), buildOwnerNotifier(process.env, { desk: deskNotifier(engine.db) }).notifier, {
    livemode,
    previousSecret: process.env.STRIPE_WEBHOOK_SECRET_PREVIOUS,
  });
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json({ received: true, duplicate: result.duplicate });
}
