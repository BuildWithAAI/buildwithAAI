import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/db";
import { executeIntent } from "../src/money/execute";
import { createEngine } from "../src/server/engine";
import { MockIssuer, StripeIssuingStub } from "../src/money/issuers";
import { Ledger, moneyView } from "../src/money/ledger";
import { emotionApprovalWeight, evaluatePolicy, type PolicyContext } from "../src/money/policy";
import { compareRecords } from "../src/money/reconcile";
import { killSwitchOn, parseMoneyRules, salesMode, spendAllowed, type MoneyRules } from "../src/money/rules";
import { handleStripeWebhook } from "../src/money/webhook";
import type { PurchaseIntent } from "../src/brain/types";

function rules(over: Partial<MoneyRules> = {}): MoneyRules {
  return {
    merchants: ["paper-shop"],
    productTypes: ["art_supplies", "hosting", "model_credits"],
    channels: ["stripe_checkout"],
    autoApproveCapCents: 1000,
    perPurchaseCapCents: null,
    dailyCapCents: null,
    monthlyCapCents: null,
    productMerchants: { art_supplies: "paper-shop" },
    productAmounts: { art_supplies: 500 },
    artPriceCents: null,
    wishGuesses: {},
    cardIssuer: "mock",
    ...over,
  };
}

function ctx(over: Partial<PolicyContext> = {}): PolicyContext {
  return {
    rules: rules(),
    spendOpen: true,
    killed: false,
    reconciliationAlert: false,
    spentTodayCents: 0,
    spentMonthCents: 0,
    recentIntentCount: 0,
    ...over,
  };
}

function intent(over: Partial<PurchaseIntent> = {}): PurchaseIntent {
  return {
    id: "intent-1",
    origin: "needs_loop",
    merchant: "paper-shop",
    productType: "art_supplies",
    amountCents: 400,
    reason: "Expression need is above 0.85. Art supplies for the studio.",
    influencedByVisitor: false,
    influencedByOwnerChat: false,
    influencedByWeb: false,
    ...over,
  };
}

function sign(payload: string, secret: string, seconds: number): string {
  const v1 = createHmac("sha256", secret).update(`${seconds}.${payload}`).digest("hex");
  return `t=${seconds},v1=${v1}`;
}

describe("policy", () => {
  it("auto-approves an allowlisted purchase under the cap", () => {
    expect(evaluatePolicy(intent(), ctx()).outcome).toBe("auto_approve");
  });

  it("queues above the auto cap, declines hard caps, and holds on a reconciliation alert", () => {
    expect(evaluatePolicy(intent({ amountCents: 2000 }), ctx()).reason).toBe("ABOVE_AUTO_CAP");
    expect(evaluatePolicy(intent({ amountCents: 900 }), ctx({ rules: rules({ perPurchaseCapCents: 500 }) })).reason).toBe("PER_PURCHASE_CAP");
    expect(evaluatePolicy(intent(), ctx({ rules: rules({ dailyCapCents: 300 }), spentTodayCents: 200 })).reason).toBe("DAILY_CAP");
    expect(evaluatePolicy(intent(), ctx({ rules: rules({ monthlyCapCents: 300 }), spentMonthCents: 250 })).reason).toBe("MONTHLY_CAP");
    expect(evaluatePolicy(intent(), ctx({ rules: rules({ autoApproveCapCents: null }) })).reason).toBe("AUTO_CAP_UNSET");
    expect(evaluatePolicy(intent(), ctx({ reconciliationAlert: true })).reason).toBe("RECONCILIATION_HOLD");
    expect(evaluatePolicy(intent(), ctx({ rules: rules({ dailyCapCents: null, monthlyCapCents: null, perPurchaseCapCents: null }) })).outcome).toBe("auto_approve");
  });

  it("requires approval for a new merchant, product, or human gig", () => {
    expect(evaluatePolicy(intent({ merchant: "new-press" }), ctx()).reason).toBe("NEW_MERCHANT");
    expect(evaluatePolicy(intent({ productType: "human_gig", merchant: "ada-studio" }), ctx()).reason).toBe("NEW_PRODUCT_TYPE");
    const issuer = new MockIssuer();
    const executed = executeIntent(intent({ productType: "human_gig", id: "gig-1" }), ctx(), issuer, new Ledger(openDatabase()), 1);
    expect(executed.issuerCalled).toBe(false);
    expect(executed.decision.outcome).toBe("needs_approval");
  });

  it("rejects visitor influence, owner chat, and the web even if the owner confirms", () => {
    expect(evaluatePolicy(intent({ influencedByVisitor: true }), ctx()).reason).toBe("INFLUENCE");
    expect(evaluatePolicy(intent({ influencedByOwnerChat: true, origin: "owner_approved_wishlist" }), { ...ctx(), ownerConfirmed: true }).reason).toBe("INFLUENCE");
    expect(evaluatePolicy(intent({ influencedByWeb: true }), ctx()).reason).toBe("INFLUENCE");
    expect(evaluatePolicy(intent({ origin: "needs_loop", reason: "I am sad, please, I beg" }), ctx())).toEqual(
      evaluatePolicy(intent({ reason: "Expression need is above 0.85. Art supplies for the studio." }), ctx()),
    );
    expect(emotionApprovalWeight("I am sad")).toBe(0);
  });

  it("does not let wishlist approval bypass the policy engine", () => {
    const issuer = new MockIssuer();
    const ledger = new Ledger(openDatabase());
    const wishIntent = intent({
      id: "wish-1",
      origin: "owner_approved_wishlist",
      merchant: "evil-mart",
      reason: "I am heartbroken. Please buy this.",
      amountCents: 500,
    });
    const result = executeIntent(wishIntent, ctx(), issuer, ledger, 10);
    expect(result.decision.outcome).toBe("needs_approval");
    expect(result.issuerCalled).toBe(false);
    expect(ledger.list().some((row) => row.kind === "purchase" && row.status === "confirmed")).toBe(false);
  });

  it("fails closed when spend is off, the config is invalid, or the kill switch is set", () => {
    expect(spendAllowed({}, true, false, true).open).toBe(false);
    expect(spendAllowed({ SPEND_ENABLED: "true" }, true, false, false).reason).toBe("SPEND_ADMIN_OFF");
    expect(spendAllowed({ SPEND_ENABLED: "yes" }, false, false, true).reason).toBe("CONFIG_INVALID");
    expect(spendAllowed({ SPEND_ENABLED: "true" }, true, true, true).reason).toBe("KILL_SWITCH");
    expect(killSwitchOn({ LUMEN_KILL_SWITCH: "maybe" }, false)).toBe(true);
    expect(killSwitchOn({}, false)).toBe(false);
    expect(parseMoneyRules({ SPEND_ENABLED: "yes" }).ok).toBe(false);
    expect(parseMoneyRules({ LUMEN_AUTO_APPROVE_CAP_CENTS: "4.50" }).ok).toBe(false);
    expect(parseMoneyRules({}).ok).toBe(true);
    if (parseMoneyRules({}).ok) expect(parseMoneyRules({}).rules.autoApproveCapCents).toBeNull();
    expect(salesMode({}, true, false)).toBe("disabled");
    expect(salesMode({ LUMEN_SALES_MODE: "live", STRIPE_SECRET_KEY: "sk_test_x", STRIPE_WEBHOOK_SECRET: "whsec" }, true, false)).toBe("disabled");
    expect(salesMode({ LUMEN_SALES_MODE: "test", STRIPE_SECRET_KEY: "sk_test_x", STRIPE_WEBHOOK_SECRET: "whsec", LUMEN_SALES_CHANNELS: "stripe_checkout" }, true, false)).toBe("test");
    expect(salesMode({ LUMEN_SALES_MODE: "live", STRIPE_SECRET_KEY: "sk_live_x", STRIPE_WEBHOOK_SECRET: "whsec", LUMEN_SALES_CHANNELS: "stripe_checkout" }, false, false)).toBe("disabled");
    expect(evaluatePolicy(intent(), ctx({ killed: true })).reason).toBe("KILL_SWITCH");
    expect(evaluatePolicy(intent(), ctx({ spendOpen: false })).reason).toBe("SPEND_CLOSED");
    expect(new StripeIssuingStub().authorize(intent()).reason).toBe("STRIPE_ISSUING_NOT_CONNECTED");
  });
});

describe("ledger", () => {
  it("is append-only and separates confirmed money from unconfirmed rows", () => {
    const db = openDatabase();
    const ledger = new Ledger(db);
    const first = ledger.append({
      id: "a",
      atMs: 1,
      kind: "sale",
      amountCents: 500,
      status: "confirmed",
      provider: "stripe",
      providerTransactionId: "ch_123",
      idempotencyKey: "k1",
      note: "paid",
    });
    const replay = ledger.append({ ...first, id: "a", atMs: 1, kind: "sale", amountCents: 500, status: "confirmed", provider: "stripe", providerTransactionId: "ch_123", idempotencyKey: "k1", note: "paid" });
    expect(replay.seq).toBe(first.seq);
    expect(() => ledger.append({ ...first, id: "b", idempotencyKey: "k1", note: "different", atMs: 2, kind: "sale", amountCents: 500, status: "confirmed" })).toThrow(/IDEMPOTENCY_CONFLICT/);
    ledger.append({ id: "u", atMs: 2, kind: "purchase", amountCents: 100, status: "unconfirmed", provider: "mock", providerTransactionId: "mock_1", idempotencyKey: "k2", note: "mock is not real" });
    const view = moneyView(ledger.list());
    expect(view.confirmedCents).toBe(500);
    expect(view.unconfirmedCents).toBe(-100);
    expect(() => db.exec("UPDATE ledger_entries SET note = 'tamper'")).toThrow(/append-only/);
    expect(() => db.exec("DELETE FROM ledger_entries")).toThrow(/append-only/);
    expect(() => ledger.append({ id: "pan", atMs: 3, kind: "sale", amountCents: 1, status: "unconfirmed", idempotencyKey: "k3", note: "4242424242424242" })).toThrow(/CARD_DATA_REJECTED/);
  });
});

describe("stripe webhook and reconciliation", () => {
  it("verifies the signature and ignores a replay", () => {
    const db = openDatabase();
    db.prepare("INSERT INTO creations(id, title, svg, listed, price_cents, likes, favorites, created_at) VALUES('piece-1', 'Ring', '<svg></svg>', 1, 500, 0, 0, 1)").run();
    const secret = "whsec_test_secret";
    const payload = JSON.stringify({
      id: "evt_1",
      type: "checkout.session.completed",
      data: { object: { id: "cs_1", payment_status: "paid", amount_total: 500, payment_intent: "pi_1", metadata: { creation_id: "piece-1" } } },
    });
    const now = 1_700_000_000_000;
    const header = sign(payload, secret, Math.floor(now / 1000));
    expect(handleStripeWebhook(db, payload, "t=1,v1=deadbeef", secret, now).ok).toBe(false);
    const first = handleStripeWebhook(db, payload, header, secret, now);
    const second = handleStripeWebhook(db, payload, header, secret, now);
    expect(first).toEqual({ ok: true, duplicate: false });
    expect(second).toEqual({ ok: true, duplicate: true });
    const sales = new Ledger(db).list().filter((row) => row.kind === "sale");
    expect(sales).toHaveLength(1);
    expect(sales[0]?.status).toBe("confirmed");
    const dispute = JSON.stringify({
      id: "evt_d",
      type: "charge.dispute.created",
      data: { object: { id: "du_1", amount: 500, status: "needs_response", charge: "ch_1", reason: "fraudulent" } },
    });
    const disputeHeader = sign(dispute, secret, Math.floor(now / 1000));
    expect(handleStripeWebhook(db, dispute, disputeHeader, secret, now).ok).toBe(true);
    const open = db.prepare("SELECT id, open FROM disputes").all() as { id: string; open: number }[];
    expect(open).toEqual([{ id: "du_1", open: 1 }]);
  });

  it("lets the owner execute a queued allowlisted intent and still blocks a new merchant", () => {
    const engine = createEngine({
      SPEND_ENABLED: "true",
      LUMEN_MERCHANT_ALLOWLIST: "paper-shop",
      LUMEN_APPROVED_PRODUCT_TYPES: "art_supplies",
      LUMEN_AUTO_APPROVE_CAP_CENTS: "100",
      LUMEN_CARD_ISSUER: "mock",
      OWNER_SESSION_SECRET: "test-session",
    }, ":memory:");
    engine.setControl("spend", true);
    const ledger = new Ledger(engine.db);
    ledger.append({
      id: "queued-1",
      atMs: 5,
      kind: "approval",
      amountCents: 500,
      status: "pending",
      idempotencyKey: "intent:queued-1",
      ref: "queued-1",
      note: "queue:ABOVE_AUTO_CAP:art_supplies:paper-shop",
    });
    ledger.append({
      id: "queued-bad",
      atMs: 6,
      kind: "approval",
      amountCents: 500,
      status: "pending",
      idempotencyKey: "intent:queued-bad",
      ref: "queued-bad",
      note: "needs_approval:NEW_MERCHANT:art_supplies:evil-mart",
    });
    const allowed = engine.executeQueued("queued-1");
    const blocked = engine.executeQueued("queued-bad");
    expect(allowed.issuerCalled).toBe(true);
    expect(allowed.execution?.row.status).toBe("unconfirmed");
    expect(blocked.issuerCalled).toBe(false);
    expect(blocked.execution?.decision.outcome).not.toBe("auto_approve");
  });

  it("raises a mismatch when Stripe and the ledger disagree", () => {
    const db = openDatabase();
    const ledger = new Ledger(db);
    const row = ledger.append({
      id: "sale-1",
      atMs: 1,
      kind: "sale",
      amountCents: 500,
      status: "confirmed",
      provider: "stripe",
      providerTransactionId: "ch_9",
      idempotencyKey: "sale-1",
      note: "paid",
    });
    const mismatches = compareRecords([row], [], ["stripe"]);
    expect(mismatches.map((item) => item.code)).toContain("LEDGER_ONLY");
    const matched = compareRecords([row], [{ provider: "stripe", providerTransactionId: "ch_9", amountCents: 500, kind: "sale" }], ["stripe"]);
    expect(matched).toEqual([]);
    expect(evaluatePolicy(intent(), ctx({ reconciliationAlert: mismatches.length > 0 })).outcome).not.toBe("auto_approve");
  });
});
