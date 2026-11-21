import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { openDatabase, setFlag } from "../src/db/db";
import { considerVenture, decideVenture, listVentures, PROPOSE_EVERY_MS, proposeVenture, scorecard } from "../src/economy/ventures";
import { decideProduct, getPodOrder, listPodOrders, openPaidPrint, printCheckout, printRefunded, printsForSale, proposeProduct, readShipping, recordPaidPrint, refundPaidPrint, syncOpenPodOrders } from "../src/fulfillment/pod";
import { Ledger } from "../src/money/ledger";
import { parsePaidSession, stripeSalesClient, type SalesClient } from "../src/money/stripe";
import { handleStripeWebhook } from "../src/money/webhook";
import { protectedPath } from "../src/security/protected";
import { launched, proposeWithPlan } from "./helpers/venture";

const T = 1_800_000_000_000;
const STRIPE = ["sk", "test", "abcdefghijklmnop"].join("_");
const ENV = { PRINTFUL_TOKEN: ["pf", "test", "token"].join("-"), PRINTFUL_ART_HOSTS: "zoora.ai", STRIPE_SECRET_KEY: STRIPE, POD_SHIPPING_CENTS: "500" };
const ART = "https://zoora.ai/art/tide-01.png";
const SESSION = "cs_test_a1b2c3d4e5f6";
const INTENT = "pi_test_112233";

/** Stands in for both Stripe and Printful. The test moves their state by hand. */
function world(start: { total?: string; paid?: boolean; amount?: number; country?: string; address?: boolean } = {}) {
  const state = {
    printful: { exists: false, status: "draft", total: start.total ?? "14.00", sent: null as Record<string, unknown> | null },
    stripe: { paid: start.paid ?? true, amount: start.amount ?? 3_000, country: start.country ?? "US", address: start.address ?? true, down: false, refunds: [] as string[] },
    calls: [] as string[],
  };
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    state.calls.push(`${method} ${url.replace(/^https:\/\/[^/]+/, "")}`);
    if (url.startsWith("https://api.stripe.com/v1/checkout/sessions/")) {
      if (state.stripe.down) return new Response("{}", { status: 503 });
      return new Response(JSON.stringify({
        id: SESSION,
        payment_status: state.stripe.paid ? "paid" : "unpaid",
        amount_total: state.stripe.amount,
        payment_intent: INTENT,
        metadata: { print_product: "tide-tee" },
        collected_information: state.stripe.address ? { shipping_details: { name: "Test Buyer", address: { line1: "1 Test Street", line2: null, city: "Testville", state: "OK", country: state.stripe.country, postal_code: "00000" } } } : {},
      }));
    }
    if (url === "https://api.stripe.com/v1/refunds") {
      state.stripe.refunds.push(String(init?.body ?? ""));
      return new Response(JSON.stringify({ id: "re_test_1" }));
    }
    const p = state.printful;
    if (method === "POST" && url.endsWith("/v2/orders")) {
      p.exists = true;
      p.sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
    } else if (method === "POST" && url.endsWith("/confirmation")) p.status = "pending";
    else if (method === "DELETE") {
      p.exists = false;
      return new Response(null, { status: 204 });
    } else if (!p.exists) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify({ data: { id: 7001, status: p.status, costs: { calculation_status: "done", total: p.total } } }));
  }) as typeof fetch;
  return { state, impl };
}

function shop() {
  const db = openDatabase();
  launched(db, "tide-prints", "prints", 3_000, 30, T);
  proposeProduct(db, ENV, { id: "tide-tee", ventureId: "tide-prints", title: "Tide tee", variantId: 4012, placement: "front", technique: "dtg", artUrl: ART, retailCents: 2_500 }, T);
  decideProduct(db, "tide-tee", "approved", true, T);
  return db;
}

function paid(db: ReturnType<typeof openDatabase>, amountCents = 3_000) {
  return recordPaidPrint(db, { sessionId: SESSION, productId: "tide-tee", amountCents, paymentIntentId: INTENT }, T)!;
}

function signed(event: Record<string, unknown>, secret: string, at: number) {
  const payload = JSON.stringify(event);
  const stamp = Math.floor(at / 1000);
  return { payload, header: `t=${stamp},v1=${createHmac("sha256", secret).update(`${stamp}.${payload}`).digest("hex")}` };
}

describe("buying a print on the site", () => {
  it("asks Stripe for a checkout that collects an address and charges shipping", async () => {
    const db = shop();
    let body = "";
    const client = stripeSalesClient(STRIPE, (async (_url: RequestInfo | URL, init?: RequestInit) => {
      body = String(init?.body);
      return new Response(JSON.stringify({ id: SESSION, url: "https://checkout.stripe.com/c/pay/x" }));
    }) as typeof fetch);
    const result = await printCheckout(db, ENV, "tide-tee", true, T, client);
    expect(result).toEqual({ ok: true, url: "https://checkout.stripe.com/c/pay/x" });
    const sent = new URLSearchParams(body);
    expect(sent.get("metadata[print_product]")).toBe("tide-tee");
    expect(sent.get("metadata[creation_id]")).toBeNull();
    expect(sent.get("line_items[0][price_data][unit_amount]")).toBe("2500");
    expect(sent.get("shipping_address_collection[allowed_countries][0]")).toBe("US");
    expect(sent.get("shipping_options[0][shipping_rate_data][fixed_amount][amount]")).toBe("500");
    expect(sent.get("success_url")).toBe("https://zoora.ai/merch?checkout=success");
    // No order exists until Stripe says it was paid.
    expect(listPodOrders(db)).toHaveLength(0);
  });

  it("is closed when sales are off, a key is missing, or the product is not on sale", async () => {
    const db = shop();
    const never = { createCheckout: async () => { throw new Error("must not be called"); } } as unknown as SalesClient;
    expect(await printCheckout(db, ENV, "tide-tee", false, T, never)).toEqual({ ok: false, error: "CLOSED" });
    expect(await printCheckout(db, { ...ENV, PRINTFUL_TOKEN: "" }, "tide-tee", true, T, never)).toEqual({ ok: false, error: "CLOSED" });
    expect(await printCheckout(db, { ...ENV, STRIPE_SECRET_KEY: "" }, "tide-tee", true, T, never)).toEqual({ ok: false, error: "CLOSED" });
    expect(await printCheckout(db, ENV, "no-such", true, T, never)).toEqual({ ok: false, error: "NOT_LISTED" });
    decideProduct(db, "tide-tee", "retired", false, T);
    expect(printsForSale(db, T)).toHaveLength(0);
    expect(await printCheckout(db, ENV, "tide-tee", true, T, never)).toEqual({ ok: false, error: "NOT_LISTED" });
  });

  it("the paid webhook writes one order and one sale, and replays change nothing", () => {
    const db = shop();
    const secret = "whsec_test";
    const event = { id: "evt_1", type: "checkout.session.completed", data: { object: { id: SESSION, payment_status: "paid", amount_total: 3_000, payment_intent: INTENT, metadata: { print_product: "tide-tee" } } } };
    const first = signed(event, secret, T);
    expect(handleStripeWebhook(db, first.payload, first.header, secret, T)).toMatchObject({ ok: true, duplicate: false });
    expect(handleStripeWebhook(db, first.payload, first.header, secret, T)).toMatchObject({ ok: true, duplicate: true });
    const again = signed({ ...event, id: "evt_2" }, secret, T);
    handleStripeWebhook(db, again.payload, again.header, secret, T);
    const orders = listPodOrders(db);
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ status: "paid", retailCents: 3_000, paidRef: `stripe:${SESSION}`, paymentIntentId: INTENT });
    expect(new Ledger(db).list().filter((row) => row.kind === "sale")).toHaveLength(1);
  });

  it("an unpaid session writes nothing", () => {
    const db = shop();
    const event = signed({ id: "evt_1", type: "checkout.session.completed", data: { object: { id: SESSION, payment_status: "unpaid", amount_total: 3_000, payment_intent: INTENT, metadata: { print_product: "tide-tee" } } } }, "whsec_test", T);
    handleStripeWebhook(db, event.payload, event.header, "whsec_test", T);
    expect(listPodOrders(db)).toHaveLength(0);
  });

  it("paid, opened with the address from Stripe, priced, and waiting for the owner", async () => {
    const db = shop();
    const { impl, state } = world();
    const order = paid(db);
    expect(await syncOpenPodOrders(db, ENV, T, impl)).toBeGreaterThan(0);
    await syncOpenPodOrders(db, ENV, T, impl);
    expect(getPodOrder(db, order.id)).toMatchObject({ status: "priced", costCents: 1_400, printfulId: 7001 });
    expect(state.printful.sent).toMatchObject({ external_id: order.id, recipient: { name: "Test Buyer", address1: "1 Test Street", city: "Testville", state_code: "OK", country_code: "US", zip: "00000" } });
    // Nothing printed: the owner has not switched on confirming by herself.
    expect(state.printful.status).toBe("draft");
    expect(JSON.stringify(db.prepare("SELECT * FROM pod_orders").all())).not.toContain("Test Street");
  });

  it("with the switch on, a paid order goes all the way to print by itself", async () => {
    const db = shop();
    setFlag(db, "pod_auto_confirm", "1");
    const { impl, state } = world();
    const order = paid(db);
    await syncOpenPodOrders(db, ENV, T, impl);
    await syncOpenPodOrders(db, ENV, T, impl);
    expect(getPodOrder(db, order.id)?.status).toBe("confirmed");
    expect(state.printful.status).toBe("pending");
    expect(scorecard(db, "tide-prints", T)).toMatchObject({ incomeCents: 3_000, expenseCents: 1_400 });
    expect(state.calls.filter((call) => call.endsWith("/confirmation"))).toHaveLength(1);
  });

  it("asks Stripe again and refuses when the payment does not match", async () => {
    for (const wrong of [{ paid: false }, { amount: 100 }, { address: false }, { country: "FR" }]) {
      const db = shop();
      const { impl, state } = world(wrong);
      const order = paid(db);
      const after = await openPaidPrint(db, ENV, order.id, T, impl);
      expect(after.status).toBe("refused");
      expect(state.printful.exists).toBe(false);
      const alerts = db.prepare("SELECT title FROM owner_alerts").all() as { title: string }[];
      expect(alerts.some((alert) => alert.title === "A paid print order needs a refund")).toBe(true);
    }
  });

  it("waits when Stripe cannot be reached, and opens on a later beat", async () => {
    const db = shop();
    const { impl, state } = world();
    const order = paid(db);
    state.stripe.down = true;
    expect((await openPaidPrint(db, ENV, order.id, T, impl)).status).toBe("paid");
    state.stripe.down = false;
    expect((await openPaidPrint(db, ENV, order.id, T, impl)).status).toBe("draft");
  });

  it("a sale that leaves too little is refused, the owner is told, and one click sends the money back", async () => {
    const db = shop();
    const { impl, state } = world({ total: "29.00" });
    const order = paid(db);
    await syncOpenPodOrders(db, ENV, T, impl);
    await syncOpenPodOrders(db, ENV, T, impl);
    expect(getPodOrder(db, order.id)).toMatchObject({ status: "refused", reason: "MARGIN" });
    expect(state.printful.exists).toBe(false);
    const client = stripeSalesClient(STRIPE, impl);
    expect((await refundPaidPrint(db, ENV, order.id, T, client)).status).toBe("refunded");
    expect(state.stripe.refunds).toEqual([`payment_intent=${INTENT}`]);
    await expect(refundPaidPrint(db, ENV, order.id, T, client)).rejects.toThrow("POD_NOT_REFUNDABLE");
    expect(state.stripe.refunds).toHaveLength(1);
  });

  it("only a paid order that will not be printed can be refunded from the desk", async () => {
    const db = shop();
    const { impl } = world();
    const order = paid(db);
    await syncOpenPodOrders(db, ENV, T, impl);
    await expect(refundPaidPrint(db, ENV, order.id, T, stripeSalesClient(STRIPE, impl))).rejects.toThrow("POD_NOT_REFUNDABLE");
  });

  it("paid for something since withdrawn goes straight to the refund list", () => {
    const db = shop();
    decideProduct(db, "tide-tee", "retired", false, T);
    expect(paid(db)).toMatchObject({ status: "refused", reason: "NOT_FOR_SALE" });
  });
});

describe("refunds and shipping read back", () => {
  it("a refund before printing stops the order and removes the draft", async () => {
    const db = shop();
    const { impl, state } = world();
    const order = paid(db);
    await syncOpenPodOrders(db, ENV, T, impl);
    await syncOpenPodOrders(db, ENV, T, impl);
    printRefunded(db, ENV, INTENT, [{ id: "re_1", amountCents: 3_000 }], T, impl);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getPodOrder(db, order.id)?.status).toBe("refunded");
    expect(state.printful.exists).toBe(false);
    expect(scorecard(db, "tide-prints", T)).toMatchObject({ incomeCents: 0, expenseCents: 0 });
  });

  it("a refund after printing is a cost on the scorecard, counted once", async () => {
    const db = shop();
    setFlag(db, "pod_auto_confirm", "1");
    const { impl } = world();
    paid(db);
    await syncOpenPodOrders(db, ENV, T, impl);
    await syncOpenPodOrders(db, ENV, T, impl);
    const secret = "whsec_test";
    const refund = signed({ id: "evt_r1", type: "refund.created", data: { object: { id: "re_9", amount: 3_000, charge: "ch_9", payment_intent: INTENT } } }, secret, T);
    handleStripeWebhook(db, refund.payload, refund.header, secret, T);
    const charge = signed({ id: "evt_r2", type: "charge.refunded", data: { object: { id: "ch_9", amount: 3_000, amount_refunded: 3_000, refunded: true, payment_intent: INTENT, refunds: { data: [{ id: "re_9", amount: 3_000 }] } } } }, secret, T);
    handleStripeWebhook(db, charge.payload, charge.header, secret, T);
    expect(scorecard(db, "tide-prints", T)).toMatchObject({ incomeCents: 3_000, expenseCents: 1_400 + 3_000, netCents: -1_400 });
  });

  it("records shipped, and raises an alert when the printer cancels a charged order", async () => {
    const db = shop();
    setFlag(db, "pod_auto_confirm", "1");
    const { impl, state } = world();
    const order = paid(db);
    await syncOpenPodOrders(db, ENV, T, impl);
    await syncOpenPodOrders(db, ENV, T, impl);
    expect((await readShipping(db, ENV, order.id, T, impl)).status).toBe("confirmed");
    state.printful.status = "fulfilled";
    await syncOpenPodOrders(db, ENV, T, impl);
    expect(getPodOrder(db, order.id)?.status).toBe("shipped");

    const other = shop();
    setFlag(other, "pod_auto_confirm", "1");
    const second = world();
    const lost = paid(other);
    await syncOpenPodOrders(other, ENV, T, second.impl);
    await syncOpenPodOrders(other, ENV, T, second.impl);
    second.state.printful.status = "canceled";
    await syncOpenPodOrders(other, ENV, T, second.impl);
    expect(getPodOrder(other, lost.id)).toMatchObject({ status: "canceled", reason: "PRINTFUL_CANCELED" });
    expect((other.prepare("SELECT COUNT(*) AS n FROM owner_alerts WHERE title = 'A paid print order needs a refund'").get() as { n: number }).n).toBe(1);
  });

  it("reads the address from either place Stripe may put it", () => {
    const address = { line1: "1 Test Street", line2: null, city: "Testville", state: "OK", country: "US", postal_code: "00000" };
    const older = parsePaidSession({ payment_status: "paid", amount_total: 100, payment_intent: { id: INTENT }, metadata: { print_product: "p" }, shipping_details: { name: "A", address } });
    const newer = parsePaidSession({ payment_status: "paid", amount_total: 100, payment_intent: INTENT, metadata: { print_product: "p" }, collected_information: { shipping_details: { name: "A", address } } });
    expect(older.shipping).toEqual(newer.shipping);
    expect(older.paymentIntentId).toBe(INTENT);
    expect(parsePaidSession({ payment_status: "paid" }).shipping).toBeNull();
  });
});

describe("her own proposals", () => {
  const strong = { curiosity: 0.7, calm: 0.2 };

  it("puts one way to earn in front of the owner, in her own fixed words, and spends nothing", () => {
    const db = openDatabase();
    expect(considerVenture(db, { calm: 0.3 }, T)).toBeNull();
    const first = considerVenture(db, strong, T);
    expect(first).toMatchObject({ id: "her-prints", kind: "prints", status: "proposed", proposedBy: "zoora", budgetCents: 0 });
    expect((db.prepare("SELECT COUNT(*) AS n FROM diary").get() as { n: number }).n).toBe(1);
    expect(scorecard(db, "her-prints", T).tainted).toBe(false);
  });

  it("waits while one is undecided, then at most one a week, and never repeats a declined idea", () => {
    const db = openDatabase();
    considerVenture(db, strong, T);
    expect(considerVenture(db, strong, T + PROPOSE_EVERY_MS * 2)).toBeNull();
    decideVenture(db, "her-prints", "declined", { budgetCents: 0, days: 0 }, T);
    expect(considerVenture(db, strong, T + PROPOSE_EVERY_MS - 1)).toBeNull();
    expect(considerVenture(db, strong, T + PROPOSE_EVERY_MS)?.id).toBe("her-pages");
    expect(listVentures(db).map((venture) => venture.kind).sort()).toEqual(["prints", "writing"]);
  });

  it("skips a kind the owner already started", () => {
    const db = openDatabase();
    proposeWithPlan(db, { id: "tide-prints", name: "Tide prints", kind: "prints", by: "owner" }, T);
    decideVenture(db, "tide-prints", "approved", { budgetCents: 0, days: 30 }, T);
    expect(considerVenture(db, strong, T + PROPOSE_EVERY_MS)?.id).toBe("her-pages");
  });
});

describe("protected paths", () => {
  it("a proposal can never change the print and payment code", () => {
    for (const file of ["src/fulfillment/pod.ts", "src/fulfillment/printful.ts", "src/economy/ventures.ts", "src/money/stripe.ts"]) expect(protectedPath(file)).toBe(true);
  });
});
