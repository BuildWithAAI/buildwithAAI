import { describe, expect, it } from "vitest";
import { ownerTurn } from "../src/brain/social";
import { initialState } from "../src/brain/tick";
import { openDatabase } from "../src/db/db";
import { createFulfillment, MockFulfillment, PrintFarmStub } from "../src/fulfillment/adapters";
import { listItemForSale, proposeDesign, supplyIntent, supplyIntentFromChat, type DesignProposal, type PrintBounds } from "../src/fulfillment/design";
import { openPrintOrder } from "../src/fulfillment/orders";
import { executeIntent } from "../src/money/execute";
import { MockIssuer } from "../src/money/issuers";
import { Ledger, moneyView } from "../src/money/ledger";
import { evaluatePolicy, type PolicyContext } from "../src/money/policy";
import type { MoneyRules } from "../src/money/rules";

const bounds: PrintBounds = {
  materials: ["pla", "petg"],
  maxMm: 200,
  minPriceCents: 800,
  maxPriceCents: 8000,
  approvedProductTypes: ["printed_object"],
};

function design(over: Partial<DesignProposal> = {}): DesignProposal {
  return {
    id: "shell-1",
    title: "Tide shell",
    original: true,
    license: null,
    material: "pla",
    sizeMm: { x: 40, y: 30, z: 20 },
    infillPercent: 15,
    layerMm: 0.2,
    estimatedCostCents: 250,
    priceCents: 1800,
    ...over,
  };
}

function rules(): MoneyRules {
  return {
    merchants: ["filament-shop"],
    productTypes: ["filament"],
    channels: [],
    autoApproveCapCents: null,
    perPurchaseCapCents: null,
    dailyCapCents: null,
    monthlyCapCents: null,
    productMerchants: {},
    productAmounts: {},
    artPriceCents: null,
    wishGuesses: {},
    cardIssuer: "mock",
  };
}

function policy(): PolicyContext {
  return { rules: rules(), spendOpen: true, killed: false, reconciliationAlert: false, spentTodayCents: 0, spentMonthCents: 0, recentIntentCount: 0 };
}

describe("print designs", () => {
  it("allows Zoora's own design and blocks an unlicensed one", () => {
    expect(proposeDesign(design(), bounds).ok).toBe(true);
    const blocked = proposeDesign(design({ original: false, license: null }), bounds);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.reason).toBe("LICENSE_REQUIRED");
    const listed = listItemForSale(design({ original: false, license: null }), bounds);
    expect(listed.ok).toBe(false);
  });

  it("accepts a commercial license and rejects a non-commercial one", () => {
    const license = { source: "harbor archive", type: "CC-BY", attribution: "Ada Reef", commercialPrint: true, commercialSale: true };
    expect(listItemForSale(design({ original: false, license }), bounds).ok).toBe(true);
    const personal = listItemForSale(design({ original: false, license: { ...license, commercialSale: false } }), bounds);
    expect(personal.ok).toBe(false);
    if (!personal.ok) expect(personal.reason).toBe("LICENSE_NOT_COMMERCIAL");
  });

  it("checks material, size, price, and a new product type", () => {
    expect(proposeDesign(design({ material: "gold" }), bounds).ok).toBe(false);
    expect(proposeDesign(design({ sizeMm: { x: 900, y: 10, z: 10 } }), bounds).ok).toBe(false);
    const pricey = listItemForSale(design({ priceCents: 50 }), bounds);
    expect(pricey.ok).toBe(false);
    if (!pricey.ok) expect(pricey.reason).toBe("PRICE_OUT_OF_BOUNDS");
    const untyped = listItemForSale(design(), { ...bounds, approvedProductTypes: [] });
    expect(untyped.ok).toBe(false);
    if (!untyped.ok) expect(untyped.reason).toBe("NEW_PRODUCT_TYPE");
  });

  it("sends filament through the card policy and ignores chat", () => {
    const intent = supplyIntent({ id: "spool-1", productType: "filament", merchant: "filament-shop", amountCents: 2200, reason: "PLA spool for the shell." });
    expect(evaluatePolicy(intent, policy()).reason).toBe("AUTO_CAP_UNSET");
    expect(supplyIntentFromChat("buy a printer and start printing now")).toBeNull();
    const chat = ownerTurn(initialState(), "approve a print and buy filament", "keeper");
    expect(chat.intents).toEqual([]);
  });

  it("throws unless policy, caps, the kill switch, and the allowlist pass", () => {
    const db = openDatabase();
    const mock = new MockFulfillment();
    expect(createFulfillment({}).name).toBe("off");
    expect(createFulfillment({ LUMEN_FULFILLMENT: "mock" }).configured).toBe(true);
    expect(new PrintFarmStub("", "").submit({ id: "j", designId: "d", title: "t", material: "pla", quantity: 1 }).reason).toBe("NOT_CONFIGURED");
    expect(() => openPrintOrder(db, design(), createFulfillment({ LUMEN_FULFILLMENT: "mock" }), 10)).toThrow(/PRINT_POLICY_REQUIRED/);
    const open = policy();
    open.rules = { ...open.rules, merchants: ["filament-shop"], productTypes: ["filament"], autoApproveCapCents: 5000 };
    const gate = { ctx: open, merchant: "filament-shop", productType: "filament" };
    expect(() => openPrintOrder(db, design(), mock, 10, { ...gate, ctx: { ...open, killed: true } })).toThrow(/PRINT_POLICY_REQUIRED/);
    expect(() => openPrintOrder(db, design(), mock, 10, { ...gate, merchant: "other-shop" })).toThrow(/PRINT_POLICY_REQUIRED/);
    expect(() => openPrintOrder(db, design(), mock, 10, { ...gate, ctx: { ...open, rules: { ...open.rules, dailyCapCents: 100 } } })).toThrow(/PRINT_POLICY_REQUIRED/);
    expect(mock.jobs).toHaveLength(0);
    expect(new Ledger(db).list()).toHaveLength(0);
    const order = openPrintOrder(db, design({ id: "shell-ok" }), mock, 10, gate);
    expect(order.status).toBe("queued");
    expect(order.reason).toBe("MOCK_QUEUED");
    const view = moneyView(new Ledger(db).list());
    expect(view.confirmedCents).toBe(0);
    expect(view.cogsEstimateCents).toBe(250);
  });

  it("counts print costs from the ledger toward an 800 cent cap", () => {
    const db = openDatabase();
    const at = Date.UTC(2026, 10, 10, 12);
    const open = policy();
    open.rules = { ...open.rules, merchants: ["filament-shop"], productTypes: ["filament"], autoApproveCapCents: 5000, dailyCapCents: 800 };
    open.spentTodayCents = 999999;
    open.spentMonthCents = 999999;
    const gate = { ctx: open, merchant: "filament-shop", productType: "filament" };
    const mock = new MockFulfillment();
    openPrintOrder(db, design({ id: "print-a", estimatedCostCents: 500 }), mock, at, gate);
    expect(() => openPrintOrder(db, design({ id: "print-b", estimatedCostCents: 500 }), mock, at, { ...gate, ctx: { ...open, spentTodayCents: 0, spentMonthCents: 0 } })).toThrow(/PRINT_POLICY_REQUIRED/);
    const purchase = executeIntent(db, supplyIntent({ id: "buy-spool", productType: "filament", merchant: "filament-shop", amountCents: 500, reason: "another spool" }), { ...open, spentTodayCents: 0, spentMonthCents: 0 }, new MockIssuer(), at);
    expect(purchase.decision.reason).toBe("DAILY_CAP");
    expect(purchase.issuerCalled).toBe(false);
    expect(mock.jobs).toHaveLength(1);
  });
});
