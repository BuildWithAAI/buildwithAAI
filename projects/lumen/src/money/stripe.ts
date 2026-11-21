import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyStripeSignature(payload: string, header: string, secret: string, nowMs: number, toleranceSec = 300, previousSecret = ""): boolean {
  if (!payload || !header || !secret) return false;
  const pieces = header.split(",").map((part) => part.trim());
  const timestamp = pieces.find((part) => part.startsWith("t="))?.slice(2);
  const signatures = pieces.filter((part) => part.startsWith("v1=")).map((part) => part.slice(3));
  if (!timestamp || signatures.length === 0 || !/^\d+$/.test(timestamp)) return false;
  const age = Math.abs(nowMs / 1000 - Number(timestamp));
  if (age > toleranceSec) return false;
  const secrets = [secret, previousSecret].filter((value) => value.length > 0);
  return signatures.some((signature) => secrets.some((value) => hmacEqual(value, timestamp, payload, signature)));
}

function hmacEqual(secret: string, timestamp: string, payload: string, signature: string): boolean {
  const expected = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export type StripeEvent = { id: string; type: string; livemode?: boolean; data: { object: Record<string, unknown> } };

export function parseStripeEvent(payload: string): StripeEvent {
  const parsed = JSON.parse(payload) as StripeEvent;
  if (!parsed || typeof parsed.id !== "string" || typeof parsed.type !== "string" || !parsed.data?.object) {
    throw new Error("STRIPE_EVENT_SHAPE");
  }
  return parsed;
}

export type StripeRecord = {
  provider: "stripe";
  providerTransactionId: string;
  paymentIntentId: string | null;
  amountCents: number;
  kind: "sale" | "refund" | "payout" | "dispute";
};

/** A printed thing is shipped, so its checkout asks for an address and adds a flat shipping charge. */
export type PrintCheckout = { productId: string; countries: string[]; shippingCents: number; returnPath: string };

/** What a paid print order needs from a finished checkout. Read from Stripe when the order is opened, and not stored. */
export type PaidSession = {
  paid: boolean;
  amountCents: number;
  printProduct: string;
  paymentIntentId: string | null;
  shipping: { name: string; line1: string; line2: string; city: string; state: string; country: string; postalCode: string } | null;
};

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Newer Stripe versions put the address under `collected_information`; older ones on the session itself. */
export function parsePaidSession(json: Record<string, unknown>): PaidSession {
  const collected = (json.collected_information ?? {}) as { shipping_details?: unknown };
  const details = (collected.shipping_details ?? json.shipping_details ?? null) as { name?: unknown; address?: Record<string, unknown> | null } | null;
  const address = details?.address ?? null;
  const intent = json.payment_intent;
  const paymentIntentId = typeof intent === "string" ? intent : intent && typeof intent === "object" ? text((intent as { id?: unknown }).id) : "";
  const amount = typeof json.amount_total === "number" && Number.isSafeInteger(json.amount_total) ? json.amount_total : 0;
  return {
    paid: json.payment_status === "paid",
    amountCents: amount,
    printProduct: text((json.metadata as { print_product?: unknown } | undefined)?.print_product),
    paymentIntentId: paymentIntentId || null,
    shipping: address
      ? { name: text(details?.name), line1: text(address.line1), line2: text(address.line2), city: text(address.city), state: text(address.state), country: text(address.country), postalCode: text(address.postal_code) }
      : null,
  };
}

export async function readCheckoutSession(secret: string, sessionId: string, fetchImpl: typeof fetch = fetch): Promise<PaidSession> {
  if (!/^cs_[A-Za-z0-9_]{8,120}$/.test(sessionId)) throw new Error("SESSION_ID");
  const response = await fetchImpl(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, { headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error("SALES_PROVIDER_ERROR");
  return parsePaidSession((await response.json()) as Record<string, unknown>);
}

export type SalesClient = {
  createCheckout(input: { creationId: string; title: string; priceCents: number; origin: string; idempotencyKey: string; shopListing?: string; print?: PrintCheckout }): Promise<{ id: string; url: string }>;
  createRefund(input: { chargeId?: string | null; paymentIntentId?: string | null; idempotencyKey: string }): Promise<{ id: string }>;
  listRecords(): Promise<StripeRecord[]>;
};

export function refundFormBody(input: { chargeId?: string | null; paymentIntentId?: string | null }): URLSearchParams {
  const charge = input.chargeId ?? "";
  const paymentIntent = input.paymentIntentId ?? "";
  if (charge.startsWith("ch_")) return new URLSearchParams({ charge });
  if (paymentIntent.startsWith("pi_") || charge.startsWith("pi_")) return new URLSearchParams({ payment_intent: paymentIntent || charge });
  if (charge) return new URLSearchParams({ charge });
  throw new Error("REFUND_ID");
}

export async function listStripeCollection(fetchImpl: typeof fetch, secret: string, resource: string): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = [];
  let startingAfter = "";
  for (let page = 0; page < 50; page += 1) {
    const url = `https://api.stripe.com/v1/${resource}?limit=100${startingAfter ? `&starting_after=${encodeURIComponent(startingAfter)}` : ""}`;
    const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${secret}` } });
    if (!response.ok) throw new Error("SALES_PROVIDER_ERROR");
    const json = (await response.json()) as { data?: Record<string, unknown>[]; has_more?: boolean };
    const data = json.data ?? [];
    all.push(...data);
    if (!json.has_more || data.length === 0) break;
    const last = String(data[data.length - 1]?.id ?? "");
    if (!last || last === startingAfter) break;
    startingAfter = last;
  }
  return all;
}

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
        ...(input.shopListing ? { "metadata[shop_listing]": input.shopListing } : {}),
      });
      if (input.print) {
        body.set("success_url", `${input.origin}${input.print.returnPath}?checkout=success`);
        body.set("cancel_url", `${input.origin}${input.print.returnPath}?checkout=cancel`);
        body.delete("metadata[creation_id]");
        body.set("metadata[print_product]", input.print.productId);
        input.print.countries.forEach((country, index) => body.set(`shipping_address_collection[allowed_countries][${index}]`, country));
        body.set("shipping_options[0][shipping_rate_data][type]", "fixed_amount");
        body.set("shipping_options[0][shipping_rate_data][display_name]", "Shipping");
        body.set("shipping_options[0][shipping_rate_data][fixed_amount][amount]", String(input.print.shippingCents));
        body.set("shipping_options[0][shipping_rate_data][fixed_amount][currency]", "usd");
      }
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
      const body = refundFormBody(input);
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
    async listRecords() {
      const [charges, refunds, payouts, disputes] = await Promise.all([
        listStripeCollection(fetchImpl, secret, "charges"),
        listStripeCollection(fetchImpl, secret, "refunds"),
        listStripeCollection(fetchImpl, secret, "payouts"),
        listStripeCollection(fetchImpl, secret, "disputes"),
      ]);
      return [
        ...toRecords(charges.filter((row) => row.paid !== false), "sale"),
        ...toRecords(refunds, "refund"),
        ...toRecords(payouts.filter((row) => row.status === undefined || row.status === "paid"), "payout"),
        ...toRecords(disputes, "dispute"),
      ];
    },
  };
}

function toRecords(rows: Record<string, unknown>[], kind: StripeRecord["kind"]): StripeRecord[] {
  return rows.flatMap((row) => {
    const id = typeof row.id === "string" ? row.id : "";
    if (!id) return [];
    const paymentIntent = typeof row.payment_intent === "string" ? row.payment_intent : null;
    const amount = typeof row.amount === "number" ? row.amount : 0;
    return [{ provider: "stripe" as const, providerTransactionId: id, paymentIntentId: paymentIntent, amountCents: amount, kind }];
  });
}
