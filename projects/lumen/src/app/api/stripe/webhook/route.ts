import { publishJarvis } from "../../../../integrations/jarvis";
import { readLimitedText, WEBHOOK_MAX_BYTES } from "../../../../http/bodyLimit";
import { getEngine } from "../../../../server/engine";
import { buildOwnerNotifier, deskNotifier } from "../../../../money/notify";
import { handleStripeWebhook } from "../../../../money/webhook";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const limited = await readLimitedText(request, WEBHOOK_MAX_BYTES);
  if (!limited.ok) return Response.json({ error: "BODY_TOO_LARGE" }, { status: 413 });
  const payload = limited.text;
  const signature = request.headers.get("stripe-signature") ?? "";
  const secret = process.env.STRIPE_WEBHOOK_SECRET ?? "";
  const engine = getEngine();
  const mode = process.env.LUMEN_SALES_MODE;
  const livemode = mode === "live" ? true : mode === "test" ? false : undefined;
  const result = handleStripeWebhook(engine.db, payload, signature, secret, Date.now(), buildOwnerNotifier(process.env, { desk: deskNotifier(engine.db), db: engine.db }).notifier, {
    livemode,
    previousSecret: process.env.STRIPE_WEBHOOK_SECRET_PREVIOUS,
  });
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  if (!result.duplicate) {
    const event = JSON.parse(payload) as { type?: string; id?: string };
    const type = event.type === "checkout.session.completed" ? "sale" : event.type?.startsWith("charge.dispute") ? "alert" : null;
    if (type) void publishJarvis(process.env, { type, text: event.type ?? type }).catch(() => undefined);
  }
  return Response.json({ received: true, duplicate: result.duplicate });
}
