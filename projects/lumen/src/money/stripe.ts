import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyStripeSignature(payload: string, header: string, secret: string, nowMs: number, toleranceSec = 300): boolean {
  if (!payload || !header || !secret) return false;
  const parts = Object.fromEntries(header.split(",").map((part) => {
    const [key, value] = part.split("=");
    return [key, value];
  }));
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature || !/^\d+$/.test(timestamp)) return false;
  const age = Math.abs(nowMs / 1000 - Number(timestamp));
  if (age > toleranceSec) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export type StripeEvent = { id: string; type: string; data: { object: Record<string, unknown> } };

export function parseStripeEvent(payload: string): StripeEvent {
  const parsed = JSON.parse(payload) as StripeEvent;
  if (!parsed || typeof parsed.id !== "string" || typeof parsed.type !== "string" || !parsed.data?.object) {
    throw new Error("STRIPE_EVENT_SHAPE");
  }
  return parsed;
}

export type SalesClient = {
  createCheckout(input: { creationId: string; title: string; priceCents: number; origin: string; idempotencyKey: string }): Promise<{ id: string; url: string }>;
  createRefund(input: { chargeId: string; idempotencyKey: string }): Promise<{ id: string }>;
  listCharges(): Promise<{ provider: string; providerTransactionId: string; amountCents: number; kind: string }[]>;
};

export function stripeSalesClient(secret: string, fetchImpl: typeof fetch = fetch): SalesClient {
  return {
    async createCheckout(input) {
      const body = new URLSearchParams({
        mode: "payment",
        success_url: `${input.origin}/gallery?checkout=success`,
        cancel_url: `${input.origin}/gallery?checkout=cancel`,
        "line_items[0][quantity]": "1",
        "line_items[0][price_data][currency]": "usd",
        "line_items[0][price_data][unit_amount]": String(input.priceCents),
        "line_items[0][price_data][product_data][name]": input.title.slice(0, 80),
        "metadata[creation_id]": input.creationId,
      });
      const response = await fetchImpl("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "Idempotency-Key": input.idempotencyKey,
        },
        body,
      });
      if (!response.ok) throw new Error("SALES_PROVIDER_ERROR");
      const json = (await response.json()) as { id?: string; url?: string };
      if (!json.id || !json.url) throw new Error("SALES_PROVIDER_ERROR");
      return { id: json.id, url: json.url };
    },
    async createRefund(input) {
      const body = new URLSearchParams({ charge: input.chargeId });
      const response = await fetchImpl("https://api.stripe.com/v1/refunds", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "Idempotency-Key": input.idempotencyKey,
        },
        body,
      });
      if (!response.ok) throw new Error("SALES_PROVIDER_ERROR");
      const json = (await response.json()) as { id?: string };
      if (!json.id) throw new Error("SALES_PROVIDER_ERROR");
      return { id: json.id };
    },
    async listCharges() {
      const response = await fetchImpl("https://api.stripe.com/v1/charges?limit=100", {
        headers: { Authorization: `Bearer ${secret}` },
      });
      if (!response.ok) throw new Error("SALES_PROVIDER_ERROR");
      const json = (await response.json()) as { data?: { id: string; amount: number; paid?: boolean }[] };
      return (json.data ?? []).filter((row) => row.paid).map((row) => ({
        provider: "stripe",
        providerTransactionId: row.id,
        amountCents: row.amount,
        kind: "sale",
      }));
    },
  };
}
