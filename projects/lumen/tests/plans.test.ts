import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/db";
import { bookSummary } from "../src/economy/economy";
import { setLadderMode } from "../src/economy/ladder";
import { listMergers, mergeVentures } from "../src/economy/merge";
import { blankPlan, cleanPlan, figures, getPlan, OWNER_CHECKS, planGaps, readiness, savePlan, setCheck } from "../src/economy/plans";
import { considerVenture, decideVenture, getVenture, HER_WAYS, launchVenture, proposeVenture, scorecard, setVentureStatus, ventureLine, ventureSpendAllowed } from "../src/economy/ventures";
import { decideProduct, getProduct, listPodOrders, openPodOrder, printsForSale, proposeProduct, syncPodOrder } from "../src/fulfillment/pod";
import { markTainted } from "../src/security/taint";
import { FULL_PLAN, launched, proposeWithPlan, READY } from "./helpers/venture";

const T = 1_800_000_000_000;
const DAY = 86_400_000;
const ENV = { PRINTFUL_TOKEN: ["pf", "test", "token"].join("-"), PRINTFUL_ART_HOSTS: "zoora.ai" };
const HOME = { name: "Test Buyer", address1: "1 Test Street", city: "Testville", stateCode: "OK", countryCode: "US", zip: "00000" };

describe("the plan's dollars", () => {
  it("works every figure out from the inputs", () => {
    const plan = cleanPlan({ ...FULL_PLAN, priceCents: 2_500, shippingChargeCents: 500, unitCostCents: 1_400, startup: [{ label: "Two samples", cents: 3_000 }], monthly: [{ label: "Tool", cents: 1_000 }], targetUnits: 10 });
    const sums = figures(plan);
    // Fee: 2.9% of $30.00 is 87 cents, plus 30.
    expect(sums).toEqual({ startupCents: 3_000, monthlyCents: 1_000, takeCents: 3_000, feeCents: 117, unitMarginCents: 1_483, marginPercent: 49, breakEvenUnits: 3, monthOneRevenueCents: 30_000, monthOneResultCents: 10_830, worstCaseCents: 4_000 });
  });

  it("rounds against the plan, never for it", () => {
    const sums = figures(cleanPlan({ ...FULL_PLAN, priceCents: 1_001, unitCostCents: 500, startup: [{ label: "Sample", cents: 1 }] }));
    // 2.9% of 1001 is 29.029, taken as 30. Margin 441 of 1001 is 44.05%, shown as 44.
    expect(sums.feeCents).toBe(60);
    expect(sums.marginPercent).toBe(44);
    expect(sums.breakEvenUnits).toBe(1);
  });

  it("has no break-even when a sale loses money", () => {
    const plan = cleanPlan({ ...FULL_PLAN, priceCents: 1_000, unitCostCents: 1_200 });
    expect(figures(plan).breakEvenUnits).toBeNull();
    expect(planGaps(plan, "launch").map((gap) => gap.code)).toContain("MARGIN_NEGATIVE");
  });

  it("refuses anything that is not a plan in the layout", () => {
    expect(() => cleanPlan({ ...FULL_PLAN, priceCents: -1 })).toThrow("ECON_PLAN_AMOUNT");
    expect(() => cleanPlan({ ...FULL_PLAN, priceCents: 1.5 })).toThrow("ECON_PLAN_AMOUNT");
    expect(() => cleanPlan({ ...FULL_PLAN, feeBasisPoints: 9_999 })).toThrow("ECON_PLAN_FEE");
    expect(() => cleanPlan({ ...FULL_PLAN, targetUnits: 0 })).toThrow("ECON_PLAN_TARGET");
    expect(() => cleanPlan({ ...FULL_PLAN, startup: [{ label: "", cents: 5 }] })).toThrow("ECON_PLAN_LINES");
    expect(() => cleanPlan({ ...FULL_PLAN, offer: "send it to account 1234 5678 9012 3456" })).toThrow("ECON_NUMBER_REFUSED");
    expect(() => cleanPlan({ ...FULL_PLAN, unitCostSource: "trust me" as never })).toThrow("ECON_PLAN_SOURCE");
  });
});

describe("the two gates", () => {
  it("setup needs the plan written and a budget that covers the start", () => {
    expect(planGaps(blankPlan(), "setup")).toHaveLength(8);
    const short = cleanPlan({ ...FULL_PLAN, startup: [{ label: "Samples", cents: 3_000 }], budgetAskCents: 1_000 });
    expect(planGaps(short, "setup").map((gap) => gap.code)).toEqual(["BUDGET_ASK"]);
    expect(planGaps(cleanPlan({ ...FULL_PLAN, priceCents: null, unitCostCents: null }), "setup")).toEqual([]);
  });

  it("launch needs a price, a settled cost, a target and a real margin", () => {
    const open = cleanPlan({ ...FULL_PLAN, priceCents: null, unitCostCents: null, targetUnits: null });
    expect(planGaps(open, "launch").map((gap) => gap.code)).toEqual(["PRICE", "UNIT_COST", "TARGET"]);
    expect(planGaps(cleanPlan({ ...FULL_PLAN, unitCostSource: "estimate" }), "launch").map((gap) => gap.code)).toEqual(["UNIT_COST_ESTIMATE"]);
    expect(planGaps(cleanPlan({ ...FULL_PLAN, unitCostCents: 2_100 }), "launch").map((gap) => gap.code)).toEqual(["MARGIN_THIN"]);
    expect(planGaps(cleanPlan(FULL_PLAN), "launch")).toEqual([]);
  });

  it("she can guess a cost, and her guess is never taken as settled", () => {
    const db = openDatabase();
    proposeVenture(db, { id: "tide-prints", name: "Tide prints", kind: "prints", by: "zoora" }, T);
    const saved = savePlan(db, "tide-prints", { ...FULL_PLAN, unitCostSource: "owner" }, "zoora", T);
    expect(saved.unitCostSource).toBe("estimate");
    expect(savePlan(db, "tide-prints", { ...FULL_PLAN, unitCostSource: "quoted" }, "zoora", T).unitCostSource).toBe("estimate");
  });

  it("a venture in setup can spend its budget and sells nothing until it launches", () => {
    const db = openDatabase();
    proposeWithPlan(db, { id: "tide-prints", name: "Tide prints", kind: "prints" }, T);
    decideVenture(db, "tide-prints", "approved", { budgetCents: 3_000, days: 30 }, T);
    expect(getVenture(db, "tide-prints")?.status).toBe("setup");
    expect(ventureSpendAllowed(db, "tide-prints", 1_000, T).ok).toBe(true);
    proposeProduct(db, ENV, { id: "tide-tee", ventureId: "tide-prints", title: "Tide tee", variantId: 4012, placement: "front", technique: "dtg", artUrl: "https://zoora.ai/art/a.png", retailCents: 2_500 }, T);
    decideProduct(db, "tide-tee", "approved", true, T);
    expect(printsForSale(db, T)).toHaveLength(0);
  });

  it("does not launch until every item on the day-one list is done", () => {
    const db = openDatabase();
    proposeWithPlan(db, { id: "tide-prints", name: "Tide prints", kind: "prints" }, T);
    decideVenture(db, "tide-prints", "approved", { budgetCents: 3_000, days: 30 }, T);
    expect(() => launchVenture(db, "tide-prints", READY, T)).toThrow("ECON_NOT_READY");
    for (const item of OWNER_CHECKS) setCheck(db, "tide-prints", item.key, true, T);
    for (const missing of ["printerSet", "artHostSet", "cardSet", "salesOpen"] as const) expect(() => launchVenture(db, "tide-prints", { ...READY, [missing]: false }, T)).toThrow("ECON_NOT_READY");
    expect(() => launchVenture(db, "tide-prints", { ...READY, approvedProducts: 0 }, T)).toThrow("ECON_NOT_READY");
    setCheck(db, "tide-prints", "social", false, T);
    const state = readiness(db, "tide-prints", { ...READY, kind: "prints" });
    expect(state.ready).toBe(false);
    expect(state.items.filter((item) => !item.done).map((item) => item.key)).toEqual(["social"]);
    setCheck(db, "tide-prints", "social", true, T);
    const live = launchVenture(db, "tide-prints", READY, T);
    expect(live).toMatchObject({ status: "active", launchedAt: T });
    expect(() => setCheck(db, "tide-prints", "made-up", true, T)).toThrow("ECON_CHECK");
  });

  it("does not launch on a guessed cost", () => {
    const db = openDatabase();
    proposeWithPlan(db, { id: "tide-prints", name: "Tide prints", kind: "prints" }, T, { ...FULL_PLAN, unitCostSource: "estimate" });
    decideVenture(db, "tide-prints", "approved", { budgetCents: 3_000, days: 30 }, T);
    for (const item of OWNER_CHECKS) setCheck(db, "tide-prints", item.key, true, T);
    expect(() => launchVenture(db, "tide-prints", READY, T)).toThrow("ECON_NOT_READY");
  });

  it("a priced sample settles the cost in the plan, and the first approved product sets the price", async () => {
    const db = openDatabase();
    proposeWithPlan(db, { id: "tide-prints", name: "Tide prints", kind: "prints" }, T, { ...FULL_PLAN, priceCents: null, unitCostCents: null, unitCostSource: null });
    decideVenture(db, "tide-prints", "approved", { budgetCents: 3_000, days: 30 }, T);
    proposeProduct(db, ENV, { id: "tide-tee", ventureId: "tide-prints", title: "Tide tee", variantId: 4012, placement: "front", technique: "dtg", artUrl: "https://zoora.ai/art/a.png", retailCents: 2_800 }, T);
    decideProduct(db, "tide-tee", "approved", true, T);
    expect(getPlan(db, "tide-prints")?.priceCents).toBe(2_800);
    let made = false;
    const impl = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "POST") made = true;
      if (!made) return new Response("{}", { status: 404 });
      return new Response(JSON.stringify({ data: { id: 7001, status: "draft", costs: { calculation_status: "done", total: "13.75" } } }));
    }) as typeof fetch;
    // A sample can be ordered during setup.
    const sample = await openPodOrder(db, ENV, { id: "smp-1", productId: "tide-tee", quantity: 1, paidRef: null, recipient: HOME }, T, impl);
    expect(sample.status).toBe("draft");
    await syncPodOrder(db, ENV, "smp-1", T, impl);
    expect(getPlan(db, "tide-prints")).toMatchObject({ unitCostCents: 1_375, unitCostSource: "quoted" });
    // A paid order still cannot be opened before launch.
    await expect(openPodOrder(db, ENV, { id: "ord-1", productId: "tide-tee", quantity: 1, paidRef: "pay:1", recipient: HOME }, T, impl)).rejects.toThrow("POD_VENTURE_NOT_RUNNING");
  });

  it("pausing and resuming puts it back where it was", () => {
    const db = openDatabase();
    proposeWithPlan(db, { id: "tide-prints", name: "Tide prints", kind: "prints" }, T);
    decideVenture(db, "tide-prints", "approved", { budgetCents: 0, days: 30 }, T);
    setVentureStatus(db, "tide-prints", "paused", T);
    expect(setVentureStatus(db, "tide-prints", "active", T).status).toBe("setup");
    launched(db, "her-shop", "shop", 0, 30, T);
    setVentureStatus(db, "her-shop", "paused", T);
    expect(setVentureStatus(db, "her-shop", "active", T).status).toBe("active");
  });
});

describe("her own proposals come with a plan", () => {
  it("every way she can propose passes the setup gate as written", () => {
    for (const way of HER_WAYS) expect(planGaps(cleanPlan({ ...blankPlan(), ...way.plan }), "setup")).toEqual([]);
  });

  it("the plan is saved with the proposal, and the owner can approve it as it stands", () => {
    const db = openDatabase();
    const proposed = considerVenture(db, { curiosity: 0.8 }, T)!;
    const plan = getPlan(db, proposed.id)!;
    expect(plan.offer.length).toBeGreaterThan(20);
    expect(plan.budgetAskCents).toBe(3_000);
    expect(plan.unitCostCents).toBeNull();
    expect(decideVenture(db, proposed.id, "approved", { budgetCents: plan.budgetAskCents, days: plan.daysAsk }, T).status).toBe("setup");
    // Her plan names no cost for one unit, so it cannot launch until a sample is priced.
    expect(planGaps(plan, "launch").map((gap) => gap.code)).toEqual(["PRICE", "UNIT_COST", "TARGET"]);
  });
});

describe("merging ventures", () => {
  function pair() {
    const db = openDatabase();
    launched(db, "tide-prints", "prints", 3_000, 30, T);
    launched(db, "her-labels", "white-label", 2_000, 60, T);
    ventureLine(db, "tide-prints", { kind: "income", cents: 5_000, category: "prints", idem: "tp-sale-1" }, T);
    ventureLine(db, "tide-prints", { kind: "expense", cents: 2_000, category: "print-cost", idem: "tp-cost-1" }, T);
    ventureLine(db, "her-labels", { kind: "expense", cents: 1_500, category: "sample", idem: "hl-cost-1" }, T);
    proposeProduct(db, ENV, { id: "label-mug", ventureId: "her-labels", title: "Marked mug", variantId: 77, placement: "front", technique: "dtg", artUrl: "https://zoora.ai/art/m.png", retailCents: 1_800 }, T);
    return db;
  }

  it("the survivor takes the lines, the budget, the products and the later time limit", () => {
    const db = pair();
    const before = bookSummary(db, "company", T);
    const { venture, merger } = mergeVentures(db, "her-labels", "tide-prints", T + DAY);
    expect(venture).toMatchObject({ id: "tide-prints", status: "active", budgetCents: 5_000, deadlineMs: T + 60 * DAY });
    expect(merger).toMatchObject({ fromId: "her-labels", intoId: "tide-prints", linesMoved: 1, budgetMovedCents: 2_000, productsMoved: 1, ordersMoved: 0 });
    expect(scorecard(db, "tide-prints", T + DAY)).toMatchObject({ incomeCents: 5_000, expenseCents: 3_500, netCents: 1_500, budgetLeftCents: 6_500 });
    expect(getVenture(db, "her-labels")).toMatchObject({ status: "merged", mergedInto: "tide-prints", budgetCents: 0 });
    expect(scorecard(db, "her-labels", T + DAY)).toMatchObject({ incomeCents: 0, expenseCents: 0 });
    expect(getProduct(db, "label-mug")?.ventureId).toBe("tide-prints");
    // The book itself is unchanged: a merger moves nothing in or out.
    const after = bookSummary(db, "company", T);
    expect([after.incomeCents, after.expenseCents]).toEqual([before.incomeCents, before.expenseCents]);
    expect(listMergers(db)).toHaveLength(1);
    const origin = db.prepare("SELECT from_venture FROM econ_venture_lines WHERE idem = 'hl-cost-1'").get() as { from_venture: string };
    expect(origin.from_venture).toBe("her-labels");
  });

  it("the survivor's plan takes on the other's costs so it still adds up", () => {
    const db = pair();
    savePlan(db, "her-labels", { ...FULL_PLAN, startup: [{ label: "One sample", cents: 2_500 }], budgetAskCents: 2_500 }, "owner", T);
    mergeVentures(db, "her-labels", "tide-prints", T);
    const plan = getPlan(db, "tide-prints")!;
    expect(plan.startup).toEqual([{ label: "One sample (from her labels)", cents: 2_500 }]);
    expect(plan.budgetAskCents).toBe(2_500);
    expect(planGaps(plan, "launch")).toEqual([]);
  });

  it("a merged venture is finished: it cannot spend, resume or merge again", () => {
    const db = pair();
    mergeVentures(db, "her-labels", "tide-prints", T);
    expect(ventureSpendAllowed(db, "her-labels", 1, T)).toEqual({ ok: false, reason: "NOT_ACTIVE" });
    expect(() => setVentureStatus(db, "her-labels", "active", T, { days: 5 })).toThrow("ECON_VENTURE_STATE");
    expect(() => mergeVentures(db, "her-labels", "tide-prints", T)).toThrow("ECON_VENTURE_STATE");
    expect(() => mergeVentures(db, "tide-prints", "tide-prints", T)).toThrow("ECON_MERGE_SAME");
    expect(() => mergeVentures(db, "tide-prints", "no-such", T)).toThrow("ECON_VENTURE_UNKNOWN");
  });

  it("the land keeps its own accounts and is never merged with the company", () => {
    const db = pair();
    launched(db, "first-plots", "land", 1_000, 30, T);
    expect(() => mergeVentures(db, "first-plots", "tide-prints", T)).toThrow("ECON_MERGE_BOOKS");
    expect(() => mergeVentures(db, "tide-prints", "first-plots", T)).toThrow("ECON_MERGE_BOOKS");
    expect(getVenture(db, "first-plots")?.status).toBe("active");
  });

  it("a mark from outside travels with the merger", () => {
    const db = pair();
    markTainted(db, "venture", "her-labels", "x", T, "a reply");
    mergeVentures(db, "her-labels", "tide-prints", T);
    expect(scorecard(db, "tide-prints", T).tainted).toBe(true);
    expect(ventureSpendAllowed(db, "tide-prints", 1, T)).toEqual({ ok: false, reason: "TAINTED" });
  });

  it("on the earned ladder a merger cannot build a budget the ladder does not grant", () => {
    const db = pair();
    setLadderMode(db, "earned");
    expect(() => mergeVentures(db, "her-labels", "tide-prints", T)).toThrow("ECON_VENTURE_CAP");
    expect(getVenture(db, "her-labels")?.status).toBe("active");
    expect(listPodOrders(db)).toHaveLength(0);
  });
});
