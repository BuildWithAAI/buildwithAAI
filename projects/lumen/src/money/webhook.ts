import { createHash, randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { Ledger } from "./ledger";
import type { OwnerNotifier } from "./notify";
import { parseStripeEvent, verifyStripeSignature, type StripeEvent } from "./stripe";

export type WebhookResult = { ok: true; duplicate: boolean } | { ok: false; status: number; error: string };

export function handleStripeWebhook(db: DatabaseSync, payload: string, header: string, secret: string, nowMs: number, notifier?: OwnerNotifier, options?: { livemode?: boolean; previousSecret?: string }): WebhookResult {
  if (!verifyStripeSignature(payload, header, secret, nowMs, 300, options?.previousSecret ?? "")) return { ok: false, status: 400, error: "BAD_SIGNATURE" };
  let event: StripeEvent;
  try {
    event = parseStripeEvent(payload);
  } catch {
    return { ok: false, status: 400, error: "BAD_PAYLOAD" };
  }
  if (typeof options?.livemode === "boolean" && typeof event.livemode === "boolean" && event.livemode !== options.livemode) {
    return { ok: false, status: 400, error: "LIVEMODE_MISMATCH" };
  }
  const seen = db.prepare("SELECT event_id FROM webhook_events WHERE event_id = ?").get(event.id) as { event_id: string } | undefined;
  if (seen) return { ok: true, duplicate: true };
  const digest = createHash("sha256").update(payload).digest("hex");
  applyEvent(db, event, nowMs, notifier);
  db.prepare("INSERT INTO webhook_events(event_id, type, payload_hash, processed_at) VALUES(?, ?, ?, ?)").run(event.id, event.type, digest, nowMs);
  return { ok: true, duplicate: false };
}

function applyEvent(db: DatabaseSync, event: StripeEvent, nowMs: number, notifier?: OwnerNotifier): void {
  const ledger = new Ledger(db);
  const object = event.data.object;
  if (event.type === "checkout.session.completed") {
    const paid = object.payment_status === "paid";
    const amount = numberField(object.amount_total);
    const creationId = String((object.metadata as { creation_id?: string } | undefined)?.creation_id ?? "");
    const paymentIntent = idString(object.payment_intent);
    const charge = idString(object.latest_charge) || idString(object.charge);
    ledger.append({
      id: `sale-${event.id}`,
      atMs: nowMs,
      kind: "sale",
      amountCents: amount,
      status: paid ? "confirmed" : "unconfirmed",
      provider: "stripe",
      providerTransactionId: charge || paymentIntent || String(object.id ?? ""),
      chargeId: charge,
      paymentIntentId: paymentIntent,
      idempotencyKey: `stripe:${event.id}`,
      ref: creationId,
      note: paid ? "Checkout paid. Confirmed by Stripe." : "Checkout not paid. Unconfirmed, not real.",
    });
    if (paid && creationId) {
      const token = randomBytes(24).toString("hex");
      db.prepare("INSERT INTO deliveries(token, creation_id, expires_at) VALUES(?, ?, ?)").run(token, creationId, nowMs + 72 * 3600 * 1000);
      db.prepare("UPDATE creations SET listed = 0 WHERE id = ?").run(creationId);
    }
    return;
  }
  if (event.type === "charge.refunded" || event.type === "refund.created") {
    bookRefunds(ledger, event, nowMs);
    return;
  }
  if (event.type === "payout.paid") {
    ledger.append({
      id: `payout-${event.id}`,
      atMs: nowMs,
      kind: "payout",
      amountCents: numberField(object.amount),
      status: "confirmed",
      provider: "stripe",
      providerTransactionId: String(object.id ?? ""),
      idempotencyKey: `stripe:${event.id}`,
      note: "Payout to the owner Stripe account.",
    });
    return;
  }
  if (event.type.startsWith("charge.dispute.")) {
    const id = String(object.id ?? event.id);
    const status = String(object.status ?? event.type);
    const amount = numberField(object.amount);
    const open = status !== "won" && status !== "lost" && status !== "warning_closed" && event.type !== "charge.dispute.closed";
    const existing = db.prepare("SELECT id FROM disputes WHERE id = ?").get(id) as { id: string } | undefined;
    const shouldAlert = (event.type === "charge.dispute.created" && !existing) || event.type === "charge.dispute.funds_withdrawn";
    if (existing) {
      db.prepare("UPDATE disputes SET status = ?, amount_cents = ?, open = ?, updated_at = ? WHERE id = ?").run(status, amount, open ? 1 : 0, nowMs, id);
    } else {
      db.prepare("INSERT INTO disputes(id, status, amount_cents, charge_id, reason, open, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?)").run(
        id,
        status,
        amount,
        String(object.charge ?? ""),
        String(object.reason ?? ""),
        open ? 1 : 0,
        nowMs,
      );
    }
    const signed = event.type === "charge.dispute.funds_reinstated" ? amount : event.type === "charge.dispute.funds_withdrawn" ? -amount : 0;
    ledger.append({
      id: `dispute-${event.id}`,
      atMs: nowMs,
      kind: "dispute",
      amountCents: signed,
      status: event.type === "charge.dispute.created" ? "unconfirmed" : "confirmed",
      provider: "stripe",
      providerTransactionId: id,
      idempotencyKey: `stripe:${event.id}`,
      ref: String(object.charge ?? ""),
      note: `Dispute ${event.type} is ${status}. Open disputes stay visible until closed.`,
    });
    if (shouldAlert) {
      notifier?.notify({
        kind: "dispute",
        title: event.type === "charge.dispute.funds_withdrawn" ? "Dispute took funds" : "New dispute",
        detail: `${id} · ${status} · ${amount} cents. Automatic spending and approvals are paused.`,
      });
    }
  }
}

function bookRefunds(ledger: Ledger, event: StripeEvent, nowMs: number): void {
  const object = event.data.object;
  const chargeId = event.type === "refund.created" ? idString(object.charge) ?? "" : String(object.id ?? "");
  const embedded = event.type === "refund.created"
    ? [{ id: String(object.id ?? ""), amount: numberField(object.amount) }]
    : refundItems(object);
  if (embedded.length > 0) {
    for (const refund of embedded) {
      if (!refund.id || ledger.findByIdempotency(`stripe:refund:${refund.id}`)) continue;
      ledger.append({
        id: `refund-${refund.id}`,
        atMs: nowMs,
        kind: "refund",
        amountCents: refund.amount,
        status: "confirmed",
        provider: "stripe",
        providerTransactionId: refund.id,
        chargeId: chargeId || null,
        paymentIntentId: idString(object.payment_intent),
        idempotencyKey: `stripe:refund:${refund.id}`,
        ref: chargeId,
        note: "Individual refund, not a running total.",
      });
    }
    return;
  }
  const cumulative = numberField(object.amount_refunded);
  const prior = ledger.list().filter((row) => row.kind === "refund" && row.chargeId === chargeId).reduce((sum, row) => sum + row.amountCents, 0);
  const delta = cumulative - prior;
  if (delta <= 0) return;
  ledger.append({
    id: `refund-${event.id}`,
    atMs: nowMs,
    kind: "refund",
    amountCents: delta,
    status: "confirmed",
    provider: "stripe",
    providerTransactionId: `delta:${event.id}`,
    chargeId: chargeId || null,
    paymentIntentId: idString(object.payment_intent),
    idempotencyKey: `stripe:${event.id}`,
    ref: chargeId,
    note: "Refund delta since the previous charge.refunded event.",
  });
}

function refundItems(object: Record<string, unknown>): { id: string; amount: number }[] {
  const data = (object.refunds as { data?: { id?: string; amount?: number }[] } | undefined)?.data ?? [];
  return data.flatMap((item) => (item.id ? [{ id: item.id, amount: numberField(item.amount) }] : []));
}

function idString(value: unknown): string | null {
  if (typeof value === "string" && value) return value;
  if (value && typeof value === "object" && "id" in value && typeof (value as { id: unknown }).id === "string") return (value as { id: string }).id;
  return null;
}

function numberField(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 0;
}
