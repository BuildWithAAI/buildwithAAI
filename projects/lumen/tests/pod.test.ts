import { describe, expect, it } from "vitest";
import { openDatabase, setFlag } from "../src/db/db";
import { bookSummary } from "../src/economy/economy";
import { decideVenture, proposeVenture, scorecard } from "../src/economy/ventures";
import { confirmPodOrder, decideProduct, getPodOrder, openPodOrder, proposeProduct, syncOpenPodOrders, syncPodOrder } from "../src/fulfillment/pod";
import { artUrlAllowed, createDraft } from "../src/fulfillment/printful";
import { markTainted } from "../src/security/taint";
import { launched, proposeWithPlan } from "./helpers/venture";

const T = 1_800_000_000_000;
const ENV = { PRINTFUL_TOKEN: ["pf", "test", "token"].join("-"), PRINTFUL_ART_HOSTS: "zoora.ai" };
const ART = "https://zoora.ai/art/tide-01.png";
const HOME = { name: "Test Buyer", address1: "1 Test Street", city: "Testville", stateCode: "OK", countryCode: "US", zip: "00000" };

type Call = { method: string; path: string; body: Record<string, unknown> | null; auth: string | null };

/** A stand-in for Printful. One order, whose state the test moves by hand. */
function printful(start: { total?: string | null; calc?: string } = {}) {
  const state = { exists: false, status: "draft", total: start.total ?? "12.50", calc: start.calc ?? "done", calls: [] as Call[], fail: null as null | { on: string; status?: number; drop?: boolean; after?: boolean } };
  const reply = () => new Response(JSON.stringify({ data: { id: 7001, external_id: "x", status: state.status, costs: { calculation_status: state.calc, total: state.calc === "done" ? state.total : null } } }), { status: 200 });
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).replace("https://api.printful.com", "");
    const method = init?.method ?? "GET";
    const headers = (init?.headers ?? {}) as Record<string, string>;
    state.calls.push({ method, path, body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null, auth: headers.Authorization ?? null });
    const key = `${method} ${path}`;
    const failing = state.fail && key.startsWith(state.fail.on) ? state.fail : null;
    const act = () => {
      if (method === "POST" && path === "/v2/orders") state.exists = true;
      if (method === "POST" && path.endsWith("/confirmation")) state.status = "pending";
      if (method === "DELETE") state.exists = false;
    };
    if (failing) {
      if (failing.after) act();
      if (failing.drop) throw new Error("socket hang up");
      return new Response("{}", { status: failing.status ?? 500 });
    }
    if (method === "GET" && !state.exists) return new Response("{}", { status: 404 });
    act();
    if (method === "DELETE") return new Response(null, { status: 204 });
    return reply();
  }) as typeof fetch;
  return { state, impl };
}

function shop(retailCents = 2_500) {
  const db = openDatabase();
  launched(db, "tide-prints", "prints", 3_000, 30, T);
  proposeProduct(db, ENV, { id: "tide-tee", ventureId: "tide-prints", title: "Tide tee", variantId: 4012, placement: "front", technique: "dtg", artUrl: ART, retailCents }, T);
  decideProduct(db, "tide-tee", "approved", true, T);
  return db;
}

describe("art addresses", () => {
  it("only https pictures on the owner's own hosts are sent to the printer", () => {
    expect(artUrlAllowed(ART, ENV)).toBe(true);
    for (const bad of ["http://zoora.ai/a.png", "https://evil.example/a.png", "https://zoora.ai.evil.example/a.png", "https://user:pw@zoora.ai/a.png", "https://zoora.ai:8443/a.png", "https://zoora.ai/a.png?x=1", "https://zoora.ai/a.svg", "https://127.0.0.1/a.png", "not a url"]) {
      expect(artUrlAllowed(bad, ENV)).toBe(false);
    }
    expect(artUrlAllowed(ART, { PRINTFUL_TOKEN: "t" })).toBe(false);
  });
});

describe("print products", () => {
  it("needs the owner to say the art is her own before it can be sold", () => {
    const db = openDatabase();
    proposeVenture(db, { id: "tide-prints", name: "Tide prints", kind: "prints", by: "zoora" }, T);
    expect(() => proposeProduct(db, ENV, { id: "bad-art", ventureId: "tide-prints", title: "Tee", variantId: 1, placement: "front", technique: "dtg", artUrl: "https://evil.example/a.png", retailCents: 2_500 }, T)).toThrow("POD_ART_URL");
    expect(() => proposeProduct(db, ENV, { id: "cheap", ventureId: "tide-prints", title: "Tee", variantId: 1, placement: "front", technique: "dtg", artUrl: ART, retailCents: 50 }, T)).toThrow("POD_PRICE");
    proposeProduct(db, ENV, { id: "tide-tee", ventureId: "tide-prints", title: "Tide tee", variantId: 4012, placement: "front", technique: "dtg", artUrl: ART, retailCents: 2_500 }, T);
    expect(() => decideProduct(db, "tide-tee", "approved", false, T)).toThrow("POD_OWN_ART_REQUIRED");
    expect(decideProduct(db, "tide-tee", "approved", true, T).status).toBe("approved");
    expect(decideProduct(db, "tide-tee", "retired", false, T).status).toBe("retired");
  });

  it("a product that is not approved, or a venture that is not running, cannot be ordered", async () => {
    const db = openDatabase();
    const { impl, state } = printful();
    proposeVenture(db, { id: "tide-prints", name: "Tide prints", kind: "prints", by: "zoora" }, T);
    proposeProduct(db, ENV, { id: "tide-tee", ventureId: "tide-prints", title: "Tide tee", variantId: 4012, placement: "front", technique: "dtg", artUrl: ART, retailCents: 2_500 }, T);
    await expect(openPodOrder(db, ENV, { id: "ord-1", productId: "tide-tee", quantity: 1, paidRef: "pay:1", recipient: HOME }, T, impl)).rejects.toThrow("POD_PRODUCT_NOT_APPROVED");
    decideProduct(db, "tide-tee", "approved", true, T);
    await expect(openPodOrder(db, ENV, { id: "ord-1", productId: "tide-tee", quantity: 1, paidRef: "pay:1", recipient: HOME }, T, impl)).rejects.toThrow("POD_VENTURE_NOT_RUNNING");
    expect(state.calls).toHaveLength(0);
  });
});

describe("print orders", () => {
  it("draft, priced, then the owner confirms: one sale and one cost on the books", async () => {
    const db = shop();
    const { impl, state } = printful();
    const opened = await openPodOrder(db, ENV, { id: "ord-1", productId: "tide-tee", quantity: 1, paidRef: "pay:1", recipient: HOME }, T, impl);
    expect(opened.status).toBe("draft");
    expect(state.calls[0]).toMatchObject({ method: "POST", path: "/v2/orders", auth: `Bearer ${ENV.PRINTFUL_TOKEN}` });
    expect(state.calls[0].body).toMatchObject({ external_id: "ord-1", order_items: [{ source: "catalog", catalog_variant_id: 4012, quantity: 1, retail_price: "25.00", placements: [{ placement: "front", technique: "dtg", layers: [{ type: "file", url: ART }] }] }] });
    expect((await syncPodOrder(db, ENV, "ord-1", T, impl)).status).toBe("priced");
    expect(getPodOrder(db, "ord-1")?.costCents).toBe(1_250);
    // Her own code may not confirm while the owner has not switched that on.
    expect(await confirmPodOrder(db, ENV, "ord-1", "auto", T, impl)).toMatchObject({ ok: false, reason: "POD_OWNER_CONFIRMS" });
    expect(state.status).toBe("draft");
    expect((await confirmPodOrder(db, ENV, "ord-1", "owner", T, impl)).ok).toBe(true);
    expect(state.status).toBe("pending");
    expect(scorecard(db, "tide-prints", T)).toMatchObject({ incomeCents: 2_500, expenseCents: 1_250, netCents: 1_250 });
    expect(bookSummary(db, "company", T).outsideExpenseCents).toBe(1_250);
    // A second click does nothing.
    expect(await confirmPodOrder(db, ENV, "ord-1", "owner", T, impl)).toMatchObject({ ok: false, reason: "POD_NOT_PRICED" });
    expect(state.calls.filter((call) => call.path.endsWith("/confirmation"))).toHaveLength(1);
    expect(scorecard(db, "tide-prints", T).incomeCents).toBe(2_500);
  });

  it("an order id that is all digits still lands on the books", async () => {
    const db = shop();
    const { impl } = printful();
    await openPodOrder(db, ENV, { id: "ord-1234567890", productId: "tide-tee", quantity: 1, paidRef: "pay:1", recipient: HOME }, T, impl);
    await syncPodOrder(db, ENV, "ord-1234567890", T, impl);
    expect((await confirmPodOrder(db, ENV, "ord-1234567890", "owner", T, impl)).ok).toBe(true);
    expect(getPodOrder(db, "ord-1234567890")?.status).toBe("confirmed");
    expect(scorecard(db, "tide-prints", T)).toMatchObject({ incomeCents: 2_500, expenseCents: 1_250 });
  });

  it("the address is sent to the printer and is not kept", async () => {
    const db = shop();
    const { impl } = printful();
    await openPodOrder(db, ENV, { id: "ord-1", productId: "tide-tee", quantity: 1, paidRef: "pay:1", recipient: HOME }, T, impl);
    const stored = JSON.stringify(db.prepare("SELECT * FROM pod_orders").all());
    expect(stored).not.toContain("Test Street");
    expect(stored).not.toContain("Test Buyer");
    expect(stored).not.toContain(ENV.PRINTFUL_TOKEN);
  });

  it("the same order id, or the same payment, never opens a second order", async () => {
    const db = shop();
    const { impl, state } = printful();
    await openPodOrder(db, ENV, { id: "ord-1", productId: "tide-tee", quantity: 1, paidRef: "pay:1", recipient: HOME }, T, impl);
    await openPodOrder(db, ENV, { id: "ord-1", productId: "tide-tee", quantity: 1, paidRef: "pay:1", recipient: HOME }, T, impl);
    await expect(openPodOrder(db, ENV, { id: "ord-2", productId: "tide-tee", quantity: 1, paidRef: "pay:1", recipient: HOME }, T, impl)).rejects.toThrow("POD_PAID_REF_USED");
    expect(state.calls.filter((call) => call.method === "POST")).toHaveLength(1);
  });

  it("waits while the cost is still being worked out", async () => {
    const db = shop();
    const { impl, state } = printful({ calc: "calculating" });
    await openPodOrder(db, ENV, { id: "ord-1", productId: "tide-tee", quantity: 1, paidRef: "pay:1", recipient: HOME }, T, impl);
    expect((await syncPodOrder(db, ENV, "ord-1", T, impl)).status).toBe("draft");
    expect(await confirmPodOrder(db, ENV, "ord-1", "owner", T, impl)).toMatchObject({ ok: false, reason: "POD_NOT_PRICED" });
    state.calc = "done";
    expect(await syncOpenPodOrders(db, ENV, T, impl)).toBe(1);
    expect(getPodOrder(db, "ord-1")?.status).toBe("priced");
  });

  it("refuses a sale that leaves too little, and deletes the draft", async () => {
    const db = shop(2_500);
    const { impl, state } = printful({ total: "21.00" });
    await openPodOrder(db, ENV, { id: "ord-1", productId: "tide-tee", quantity: 1, paidRef: "pay:1", recipient: HOME }, T, impl);
    const after = await syncPodOrder(db, ENV, "ord-1", T, impl);
    expect(after).toMatchObject({ status: "refused", reason: "MARGIN" });
    expect(state.calls.at(-1)).toMatchObject({ method: "DELETE", path: "/v2/orders/7001" });
    expect(scorecard(db, "tide-prints", T).expenseCents).toBe(0);
  });

  it("a sample is the owner's call and is held to the venture's budget", async () => {
    const db = shop();
    setFlag(db, "pod_auto_confirm", "1");
    const { impl } = printful({ total: "31.00" });
    await openPodOrder(db, ENV, { id: "smp-1", productId: "tide-tee", quantity: 1, paidRef: null, recipient: HOME }, T, impl);
    expect((await syncPodOrder(db, ENV, "smp-1", T, impl)).status).toBe("priced");
    expect(await confirmPodOrder(db, ENV, "smp-1", "auto", T, impl)).toMatchObject({ ok: false, reason: "POD_SAMPLE_IS_OWNERS" });
    // $31 against a $30 budget.
    expect(await confirmPodOrder(db, ENV, "smp-1", "owner", T, impl)).toMatchObject({ ok: false, reason: "POD_VENTURE_BUDGET" });
    const cheap = printful({ total: "14.00" });
    await openPodOrder(db, ENV, { id: "smp-2", productId: "tide-tee", quantity: 1, paidRef: null, recipient: HOME }, T, cheap.impl);
    await syncPodOrder(db, ENV, "smp-2", T, cheap.impl);
    expect((await confirmPodOrder(db, ENV, "smp-2", "owner", T, cheap.impl)).ok).toBe(true);
    expect(scorecard(db, "tide-prints", T)).toMatchObject({ incomeCents: 0, expenseCents: 1_400, budgetLeftCents: 1_600 });
  });

  it("switched on, her own code confirms a paid order, but never in a venture marked from outside", async () => {
    const db = shop();
    setFlag(db, "pod_auto_confirm", "1");
    const first = printful();
    await openPodOrder(db, ENV, { id: "ord-1", productId: "tide-tee", quantity: 1, paidRef: "pay:1", recipient: HOME }, T, first.impl);
    await syncPodOrder(db, ENV, "ord-1", T, first.impl);
    expect((await confirmPodOrder(db, ENV, "ord-1", "auto", T, first.impl)).ok).toBe(true);
    markTainted(db, "venture", "tide-prints", "buyer", T, "a buyer note");
    const second = printful();
    await openPodOrder(db, ENV, { id: "ord-2", productId: "tide-tee", quantity: 1, paidRef: "pay:2", recipient: HOME }, T, second.impl);
    await syncPodOrder(db, ENV, "ord-2", T, second.impl);
    expect(await confirmPodOrder(db, ENV, "ord-2", "auto", T, second.impl)).toMatchObject({ ok: false, reason: "POD_VENTURE_TAINTED" });
    expect(second.state.status).toBe("draft");
    expect((await confirmPodOrder(db, ENV, "ord-2", "owner", T, second.impl)).ok).toBe(true);
  });

  it("a confirm that was cut off is read back, not sent twice", async () => {
    const db = shop();
    const { impl, state } = printful();
    await openPodOrder(db, ENV, { id: "ord-1", productId: "tide-tee", quantity: 1, paidRef: "pay:1", recipient: HOME }, T, impl);
    await syncPodOrder(db, ENV, "ord-1", T, impl);
    // Printful took the confirm, and the reply was lost.
    state.fail = { on: "POST /v2/orders/7001/confirmation", drop: true, after: true };
    expect(await confirmPodOrder(db, ENV, "ord-1", "owner", T, impl)).toMatchObject({ ok: false, reason: "PRINTFUL_UNREACHABLE" });
    expect(getPodOrder(db, "ord-1")).toMatchObject({ status: "check", reason: "CONFIRM" });
    expect(scorecard(db, "tide-prints", T).incomeCents).toBe(0);
    state.fail = null;
    expect(await confirmPodOrder(db, ENV, "ord-1", "owner", T, impl)).toMatchObject({ ok: false, reason: "POD_NOT_PRICED" });
    expect((await syncPodOrder(db, ENV, "ord-1", T, impl)).status).toBe("confirmed");
    expect(state.calls.filter((call) => call.path.endsWith("/confirmation"))).toHaveLength(1);
    expect(scorecard(db, "tide-prints", T)).toMatchObject({ incomeCents: 2_500, expenseCents: 1_250 });
  });

  it("a confirm that never arrived goes back to priced", async () => {
    const db = shop();
    const { impl, state } = printful();
    await openPodOrder(db, ENV, { id: "ord-1", productId: "tide-tee", quantity: 1, paidRef: "pay:1", recipient: HOME }, T, impl);
    await syncPodOrder(db, ENV, "ord-1", T, impl);
    state.fail = { on: "POST /v2/orders/7001/confirmation", drop: true };
    await confirmPodOrder(db, ENV, "ord-1", "owner", T, impl);
    state.fail = null;
    expect((await syncPodOrder(db, ENV, "ord-1", T, impl)).status).toBe("priced");
    expect(scorecard(db, "tide-prints", T).expenseCents).toBe(0);
  });

  it("a create that was cut off is found by our own id, or marked as never arrived", async () => {
    const db = shop();
    const arrived = printful();
    arrived.state.fail = { on: "POST /v2/orders", drop: true, after: true };
    expect((await openPodOrder(db, ENV, { id: "ord-1", productId: "tide-tee", quantity: 1, paidRef: "pay:1", recipient: HOME }, T, arrived.impl)).status).toBe("check");
    arrived.state.fail = null;
    expect(await syncPodOrder(db, ENV, "ord-1", T, arrived.impl)).toMatchObject({ status: "priced", printfulId: 7001 });
    expect(arrived.state.calls.at(-1)?.path).toBe("/v2/orders/@ord-1");
    const lost = printful();
    lost.state.fail = { on: "POST /v2/orders", drop: true };
    await openPodOrder(db, ENV, { id: "ord-2", productId: "tide-tee", quantity: 1, paidRef: "pay:2", recipient: HOME }, T, lost.impl);
    lost.state.fail = null;
    expect(await syncPodOrder(db, ENV, "ord-2", T, lost.impl)).toMatchObject({ status: "failed", reason: "NEVER_ARRIVED" });
  });

  it("a refused call is recorded by a short code, with no reply text", async () => {
    const db = shop();
    const { impl, state } = printful();
    state.fail = { on: "POST /v2/orders", status: 401 };
    expect(await openPodOrder(db, ENV, { id: "ord-1", productId: "tide-tee", quantity: 1, paidRef: "pay:1", recipient: HOME }, T, impl)).toMatchObject({ status: "failed", reason: "PRINTFUL_AUTH" });
  });

  it("without a token nothing is sent", async () => {
    let sent = 0;
    const impl = (async () => {
      sent += 1;
      return new Response("{}");
    }) as typeof fetch;
    await expect(createDraft({ PRINTFUL_ART_HOSTS: "zoora.ai" }, { externalId: "ord-1", recipient: HOME, items: [{ variantId: 1, quantity: 1, retailCents: 2_500, name: "Tee", placement: "front", technique: "dtg", artUrl: ART }] }, impl)).rejects.toThrow("PRINTFUL_NOT_SET");
    expect(sent).toBe(0);
  });
});
