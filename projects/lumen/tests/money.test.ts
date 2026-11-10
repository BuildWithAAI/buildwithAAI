import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { kvSet, openDatabase } from "../src/db/db";
import net from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { allowLogin, clientAddress } from "../src/auth/owner";
import { executeIntent, resolutionProvider, resolveUnknown, resolveUnknownClaim } from "../src/money/execute";
import { createEngine } from "../src/server/engine";
import { mapDescriptor } from "../src/money/card";
import { ExpectedIssuer, MockIssuer, PrivacyStub, StripeIssuingStub } from "../src/money/issuers";
import { mintSwitch, requestMint } from "../src/money/mint";
import { Ledger, bodyHash, canonical, merchantFromLegacyNote, migrateMerchantHashes, moneyView, notifyChainBroken, verifyLedgerChain } from "../src/money/ledger";
import { emotionApprovalWeight, evaluatePolicy, type PolicyContext } from "../src/money/policy";
import { compareRecords, normalizeMerchant } from "../src/money/reconcile";
import { ALERT_GIVE_UP_MS, buildOwnerNotifier, deliverSmtp, deskClock, drainAlertRetries, guardAsyncRetry, reportDeliveryFailure, telegramApiTransport } from "../src/money/notify";
import { hardCapGap, killSwitchOn, parseMoneyRules, REQUIRE_HARD_CAPS_WHEN_SPENDING, salesCredentials, salesMode, spendAllowed, type MoneyRules } from "../src/money/rules";
import { refundFormBody, stripeSalesClient, verifyStripeSignature } from "../src/money/stripe";
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
    const executed = executeIntent(openDatabase(), intent({ productType: "human_gig", id: "gig-1" }), ctx(), issuer, 1);
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
    const db = openDatabase();
    const ledger = new Ledger(db);
    const wishIntent = intent({
      id: "wish-1",
      origin: "owner_approved_wishlist",
      merchant: "evil-mart",
      reason: "I am heartbroken. Please buy this.",
      amountCents: 500,
    });
    const result = executeIntent(db, wishIntent, ctx(), issuer, 10);
    expect(result.decision.outcome).toBe("needs_approval");
    expect(result.issuerCalled).toBe(false);
    expect(ledger.list().some((row) => row.kind === "purchase" && row.status === "confirmed")).toBe(false);
  });

  it("fails closed when spend is off, the config is invalid, or the kill switch is set", () => {
    expect(spendAllowed({}, true, false, true).open).toBe(false);
    expect(spendAllowed({ LUMEN_SPEND_ENABLED: "true", LUMEN_CARD_ISSUER: "owner_checkout" }, true, false, false).reason).toBe("SPEND_ADMIN_OFF");
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
    expect(salesMode({ STRIPE_SECRET_KEY: "sk_live_x", STRIPE_WEBHOOK_SECRET: "whsec" }, true, false)).toBe("disabled");
    expect(salesMode({ LUMEN_SALES_ENABLED: "true", STRIPE_SECRET_KEY: "sk_live_x", STRIPE_WEBHOOK_SECRET: "whsec" }, true, false)).toBe("live");
    expect(salesMode({ STRIPE_SECRET_KEY: "sk_live_x", STRIPE_WEBHOOK_SECRET: "whsec", SALES_ENABLED: "false" }, true, false)).toBe("disabled");
    expect(spendAllowed({ LUMEN_CARD_ISSUER: "stripe_issuing", STRIPE_SECRET_KEY: "sk_live_x", LUMEN_SPEND_ENABLED: "true" }, true, false, true).open).toBe(false);
    expect(spendAllowed({ LUMEN_CARD_ISSUER: "stripe_issuing", STRIPE_ISSUING_KEY: "sk_test_issuing", LUMEN_SPEND_ENABLED: "true" }, true, false, true).open).toBe(true);
    expect(spendAllowed({ LUMEN_CARD_ISSUER: "stripe_issuing", STRIPE_SECRET_KEY: "sk_live_x", SPEND_ENABLED: "false" }, true, false, true).open).toBe(false);
    expect(evaluatePolicy(intent(), ctx({ killed: true })).reason).toBe("KILL_SWITCH");
    expect(evaluatePolicy(intent(), ctx({ spendOpen: false })).reason).toBe("SPEND_CLOSED");
    expect(new StripeIssuingStub().authorize(intent(), "exec:stub").reason).toBe("STRIPE_ISSUING_NOT_CONNECTED");
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
      LUMEN_SPEND_ENABLED: "true",
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
    const again = engine.executeQueued("queued-1");
    expect(allowed.issuerCalled).toBe(true);
    expect(allowed.execution?.row?.status).toBe("unconfirmed");
    expect(again.issuerCalled).toBe(false);
    expect((engine.issuer as MockIssuer).calls).toHaveLength(1);
    expect((engine.issuer as MockIssuer).keys).toEqual(["exec:queued-1-owner-exec"]);
    expect(new Ledger(engine.db).list().filter((row) => row.kind === "purchase")).toHaveLength(1);
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
    expect(evaluatePolicy(intent(), ctx({ reconciliationAlert: true, ownerConfirmed: true })).reason).toBe("RECONCILIATION_HOLD");
  });
});

describe("purchase safety", () => {
  it("rechecks the daily cap for each purchase in one batch", () => {
    const db = openDatabase();
    const issuer = new MockIssuer();
    const at = Date.UTC(2026, 10, 9, 12);
    const shared = ctx({ rules: rules({ dailyCapCents: 800, autoApproveCapCents: 1000 }) });
    const first = executeIntent(db, intent({ id: "a", amountCents: 500 }), shared, issuer, at);
    const second = executeIntent(db, intent({ id: "b", amountCents: 500 }), shared, issuer, at);
    expect(first.decision.outcome).toBe("auto_approve");
    expect(second.decision.reason).toBe("DAILY_CAP");
    expect(issuer.calls).toHaveLength(1);
  });

  it("leaves hard caps optional until one constant is flipped", () => {
    expect(REQUIRE_HARD_CAPS_WHEN_SPENDING).toBe(false);
    const open = rules({ perPurchaseCapCents: null, dailyCapCents: null, monthlyCapCents: null });
    expect(hardCapGap(open)).toBeNull();
    expect(hardCapGap(open, true)).toBe("PER_PURCHASE_CAP_REQUIRED");
    expect(spendAllowed({ LUMEN_SPEND_ENABLED: "true", LUMEN_CARD_ISSUER: "owner_checkout" }, true, false, true).open).toBe(true);
    expect(spendAllowed({ SPEND_ENABLED: "true" }, true, false, true).open).toBe(false);
  });

  it("matches a pi_ sale to a ch_ charge and ignores payouts and disputes on the charge list", () => {
    const db = openDatabase();
    const ledger = new Ledger(db);
    const sale = ledger.append({
      id: "sale-pi",
      atMs: 1,
      kind: "sale",
      amountCents: 500,
      status: "confirmed",
      provider: "stripe",
      providerTransactionId: "pi_123",
      chargeId: null,
      paymentIntentId: "pi_123",
      idempotencyKey: "sale-pi",
      note: "paid",
    });
    const payout = ledger.append({
      id: "po",
      atMs: 2,
      kind: "payout",
      amountCents: 500,
      status: "confirmed",
      provider: "stripe",
      providerTransactionId: "po_123",
      idempotencyKey: "po",
      note: "payout",
    });
    const dispute = ledger.append({
      id: "dp",
      atMs: 3,
      kind: "dispute",
      amountCents: -500,
      status: "confirmed",
      provider: "stripe",
      providerTransactionId: "du_123",
      idempotencyKey: "dp",
      note: "dispute",
    });
    const charges = [{ provider: "stripe", providerTransactionId: "ch_123", paymentIntentId: "pi_123", amountCents: 500, kind: "sale" }];
    expect(compareRecords([sale, payout, dispute], charges, ["stripe"], ["sale"])).toEqual([]);
    const full = compareRecords([sale, payout, dispute], charges, ["stripe"], ["sale", "payout", "dispute"]);
    expect(full.map((item) => item.providerTransactionId).sort()).toEqual(["du_123", "po_123"]);
  });

  it("paginates Stripe lists and refunds a payment intent with payment_intent=", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      urls.push(String(url));
      if (String(url).includes("/refunds") && init?.method === "POST") return Response.json({ id: "re_1" });
      if (!String(url).includes("/charges")) return Response.json({ data: [], has_more: false });
      if (String(url).includes("starting_after")) return Response.json({ data: [{ id: "ch_2", amount: 200, paid: true, payment_intent: "pi_2" }], has_more: false });
      return Response.json({ data: [{ id: "ch_1", amount: 100, paid: true, payment_intent: "pi_1" }], has_more: true });
    }) as typeof fetch;
    const client = stripeSalesClient("sk_test_x", fetchImpl);
    const records = await client.listRecords();
    expect(records.filter((row) => row.kind === "sale").map((row) => row.providerTransactionId)).toEqual(["ch_1", "ch_2"]);
    expect(urls.some((url) => url.includes("starting_after=ch_1"))).toBe(true);
    expect(refundFormBody({ chargeId: "pi_123" }).toString()).toBe("payment_intent=pi_123");
    expect(refundFormBody({ chargeId: "ch_123" }).toString()).toBe("charge=ch_123");
    const refund = await client.createRefund({ chargeId: "pi_9", idempotencyKey: "refund-1" });
    expect(refund.id).toBe("re_1");
    expect(urls.some((url) => url.includes("/refunds"))).toBe(true);
  });

  it("pauses spending on a new dispute and records an owner alert", () => {
    const db = openDatabase();
    const alerts: { kind: string; title: string }[] = [];
    const secret = "whsec_test_secret";
    const now = 1_700_000_000_000;
    const payload = JSON.stringify({
      id: "evt_dispute",
      type: "charge.dispute.created",
      data: { object: { id: "du_9", amount: 700, status: "needs_response", charge: "ch_9", reason: "product_unacceptable" } },
    });
    const header = sign(payload, secret, Math.floor(now / 1000));
    const result = handleStripeWebhook(db, payload, header, secret, now, { notify: (alert) => alerts.push(alert) });
    expect(result).toEqual({ ok: true, duplicate: false });
    expect(alerts[0]).toMatchObject({ kind: "dispute", title: "New dispute" });
    const issuer = new MockIssuer();
    const execution = executeIntent(db, intent({ id: "during-dispute" }), ctx(), issuer, now);
    expect(execution.decision.reason).toBe("DISPUTE_HOLD");
    expect(execution.issuerCalled).toBe(false);
    expect(evaluatePolicy(intent(), ctx({ openDispute: true, ownerConfirmed: true })).outcome).toBe("queue");
  });
});

describe("owner login limits", () => {
  it("ignores a client-supplied forwarding header unless a trusted proxy is configured", () => {
    const spoofed = (name: string) => (name === "x-forwarded-for" ? "1.1.1.1" : null);
    const other = (name: string) => (name === "x-forwarded-for" ? "2.2.2.2" : null);
    expect(clientAddress(spoofed, undefined)).toBe("direct");
    expect(clientAddress(other, "none")).toBe("direct");
    expect(clientAddress((name) => (name === "fly-client-ip" ? "203.0.113.8" : "9.9.9.9"), "fly")).toBe("203.0.113.8");
    expect(clientAddress((name) => (name === "x-forwarded-for" ? "9.9.9.9, 198.51.100.7" : null), "forwarded")).toBe("198.51.100.7");
    const db = openDatabase();
    const now = 1_700_000_000_000;
    for (let i = 0; i < 5; i += 1) expect(allowLogin(db, "direct", now + i)).toBe(true);
    expect(allowLogin(db, "direct", now + 5)).toBe(false);
    expect(allowLogin(db, "203.0.113.9", now + 5)).toBe(true);
    expect(allowLogin(db, "direct", now + 5 + 30_000)).toBe(true);
    const otherIp = openDatabase();
    const spaced = [0, 1, 2, 3, 4, 31_000, 91_000, 211_000];
    for (const at of spaced) expect(allowLogin(otherIp, "203.0.113.1", now + at)).toBe(true);
    expect(allowLogin(otherIp, "203.0.113.1", now + 211_001)).toBe(false);
    expect(allowLogin(otherIp, "203.0.113.2", now)).toBe(true);
  });
});

describe("held execute, disputes, refunds, and alerts", () => {
  const at = Date.UTC(2026, 10, 9, 15);

  it("executes a held purchase once, including a repeat and an overlapping call", () => {
    const db = openDatabase();
    const issuer = new MockIssuer();
    const purchase = intent({ id: "held-1", amountCents: 400 });
    const held = executeIntent(db, purchase, ctx({ reconciliationAlert: true, ownerConfirmed: true }), issuer, at);
    expect(held.issuerCalled).toBe(false);
    expect(held.decision.reason).toBe("RECONCILIATION_HOLD");
    const cleared = executeIntent(db, purchase, ctx({ ownerConfirmed: true }), issuer, at);
    const repeat = executeIntent(db, purchase, ctx({ ownerConfirmed: true }), issuer, at);
    expect(cleared.issuerCalled).toBe(true);
    expect(repeat.issuerCalled).toBe(false);
    expect(issuer.calls).toHaveLength(1);
    expect(new Ledger(db).list().filter((row) => row.kind === "purchase")).toHaveLength(1);
    expect(cleared.row?.id).toBe("purchase-held-1");

    const file = path.join(mkdtempSync(path.join(tmpdir(), "lumen-")), "race.sqlite");
    const left = openDatabase(file);
    const right = openDatabase(file);
    const overlapping = {
      name: "mock" as const,
      calls: [] as string[],
      authorize(next: ReturnType<typeof intent>, key: string) {
        this.calls.push(key);
        executeIntent(right, next, ctx({ ownerConfirmed: true }), overlapping, at);
        return { providerTransactionId: "mock_race", status: "approved" as const, reason: "MOCK_APPROVED" };
      },
      listActivity() { return []; },
    };
    executeIntent(left, intent({ id: "race-1", amountCents: 400 }), ctx({ ownerConfirmed: true }), overlapping, at);
    expect(overlapping.calls).toEqual(["exec:race-1"]);
    expect(new Ledger(left).list().filter((row) => row.kind === "purchase")).toHaveLength(1);
  });

  it("does not let a decline consume the daily cap", () => {
    const db = openDatabase();
    const atMs = Date.UTC(2026, 10, 9, 16);
    const declined = executeIntent(db, intent({ id: "nope", amountCents: 500 }), ctx({ rules: rules({ dailyCapCents: 800 }) }), new PrivacyStub(), atMs);
    expect(declined.decision.outcome).toBe("decline");
    const next = executeIntent(db, intent({ id: "after", amountCents: 500 }), ctx({ rules: rules({ dailyCapCents: 800 }) }), new MockIssuer(), atMs);
    expect(next.decision.outcome).toBe("auto_approve");
  });

  it("holds an unknown issuer outcome, blocks a retry, and keeps the cap", () => {
    const atMs = Date.UTC(2026, 10, 9, 16);
    const shared = ctx({ rules: rules({ dailyCapCents: 800 }) });
    const honoring = openDatabase();
    const seen = new Map<string, { providerTransactionId: string; status: "approved"; reason: string }>();
    const dedupe = new MockIssuer();
    dedupe.authorize = (next, key) => {
      dedupe.calls.push(next);
      dedupe.keys.push(key);
      if (seen.has(key)) return seen.get(key)!;
      seen.set(key, { providerTransactionId: "pc_1", status: "approved", reason: "CHARGED_THEN_TIMEOUT" });
      throw new Error("ISSUER_TIMEOUT");
    };
    const first = executeIntent(honoring, intent({ id: "t1", amountCents: 500 }), shared, dedupe, atMs);
    expect(first.decision.reason).toBe("ISSUER_UNKNOWN");
    const retry = executeIntent(honoring, intent({ id: "t1", amountCents: 500 }), shared, dedupe, atMs);
    expect(retry.issuerCalled).toBe(false);
    expect(dedupe.calls).toHaveLength(1);
    const resolved = resolveUnknown(honoring, intent({ id: "t1", amountCents: 500 }), atMs, { lookup: () => seen.get("exec:t1") ?? null });
    expect(resolved.issuerCalled).toBe(false);
    expect(resolved.decision.reason).toBe("RESOLVED_UNKNOWN");
    expect(new Ledger(honoring).list().filter((row) => row.kind === "purchase")).toHaveLength(1);
    expect(dedupe.calls).toHaveLength(1);

    const ignoring = openDatabase();
    const fresh = new MockIssuer();
    fresh.authorize = (next, key) => {
      fresh.calls.push(next);
      fresh.keys.push(key);
      throw new Error("ISSUER_TIMEOUT");
    };
    executeIntent(ignoring, intent({ id: "t2", amountCents: 500 }), shared, fresh, atMs);
    executeIntent(ignoring, intent({ id: "t2", amountCents: 500 }), shared, fresh, atMs);
    const still = resolveUnknown(ignoring, intent({ id: "t2", amountCents: 500 }), atMs, { lookup: () => null });
    expect(fresh.calls).toHaveLength(1);
    expect(still.decision.reason).toBe("ISSUER_UNKNOWN");
    expect(new Ledger(ignoring).list().filter((row) => row.kind === "purchase")).toHaveLength(0);

    const capped = executeIntent(ignoring, intent({ id: "t3", amountCents: 500 }), shared, new MockIssuer(), atMs);
    expect(capped.decision.reason).toBe("DAILY_CAP");
    const wide = openDatabase();
    const down = new MockIssuer();
    down.authorize = () => { throw new Error("ISSUER_TIMEOUT"); };
    executeIntent(wide, intent({ id: "unk", amountCents: 100 }), ctx(), down, atMs);
    const nextIssuer = new MockIssuer();
    const paused = executeIntent(wide, intent({ id: "other", amountCents: 100 }), ctx(), nextIssuer, atMs);
    expect(paused.decision.reason).toBe("UNKNOWN_SPEND");
    expect(paused.issuerCalled).toBe(false);
    expect(nextIssuer.calls).toHaveLength(0);
    const alerts = ignoring.prepare("SELECT title FROM owner_alerts").all() as { title: string }[];
    expect(alerts.some((row) => row.title === "Issuer outcome unknown")).toBe(true);
  });

  it("treats many dispute events as one dispute and books each partial refund", () => {
    const db = openDatabase();
    const secret = "whsec_test_secret";
    const now = 1_700_000_000_000;
    const post = (id: string, type: string, object: Record<string, unknown>) => {
      const payload = JSON.stringify({ id, type, livemode: false, data: { object } });
      const header = sign(payload, secret, Math.floor(now / 1000));
      expect(handleStripeWebhook(db, payload, header, secret, now, undefined, { livemode: false }).ok).toBe(true);
    };
    post("evt_d1", "charge.dispute.created", { id: "du_1", amount: 700, status: "needs_response", charge: "ch_1", reason: "fraudulent" });
    post("evt_d2", "charge.dispute.funds_withdrawn", { id: "du_1", amount: 700, status: "needs_response", charge: "ch_1", reason: "fraudulent" });
    post("evt_d3", "charge.dispute.closed", { id: "du_1", amount: 700, status: "lost", charge: "ch_1", reason: "fraudulent" });
    const disputeRows = new Ledger(db).list().filter((row) => row.kind === "dispute");
    expect(disputeRows.length).toBeGreaterThan(1);
    expect(compareRecords(new Ledger(db).list(), [{ provider: "stripe", providerTransactionId: "du_1", amountCents: 700, kind: "dispute" }], ["stripe"], ["dispute"])).toEqual([]);
    post("evt_r1", "charge.refunded", { id: "ch_1", amount_refunded: 500, payment_intent: "pi_1", refunds: { data: [{ id: "re_1", amount: 500 }] } });
    post("evt_r2", "charge.refunded", { id: "ch_1", amount_refunded: 1000, payment_intent: "pi_1", refunds: { data: [{ id: "re_2", amount: 500 }, { id: "re_1", amount: 500 }] } });
    const refunds = new Ledger(db).list().filter((row) => row.kind === "refund");
    expect(refunds.map((row) => row.amountCents).sort()).toEqual([500, 500]);
    expect(compareRecords(new Ledger(db).list(), [
      { provider: "stripe", providerTransactionId: "re_1", amountCents: 500, kind: "refund" },
      { provider: "stripe", providerTransactionId: "re_2", amountCents: 500, kind: "refund" },
    ], ["stripe"], ["refund"])).toEqual([]);
  });

  it("accepts a rotated webhook secret and rejects a livemode mismatch", () => {
    const payload = JSON.stringify({ id: "evt_live", type: "payout.paid", livemode: true, data: { object: { id: "po_1", amount: 100 } } });
    const now = 1_700_000_000_000;
    const current = sign(payload, "whsec_new", Math.floor(now / 1000));
    const previous = sign(payload, "whsec_old", Math.floor(now / 1000));
    const rotated = `${previous},v1=${current.split("v1=")[1]}`;
    expect(verifyStripeSignature(payload, rotated, "whsec_new", now)).toBe(true);
    expect(verifyStripeSignature(payload, previous, "whsec_new", now, 300, "whsec_old")).toBe(true);
    const db = openDatabase();
    const header = sign(payload, "whsec_new", Math.floor(now / 1000));
    expect(handleStripeWebhook(db, payload, header, "whsec_new", now, undefined, { livemode: false })).toEqual({ ok: false, status: 400, error: "LIVEMODE_MISMATCH" });
  });

  it("sends an alert to every configured notifier and warns when none are configured", () => {
    const mail: string[] = [];
    const telegram: string[] = [];
    const env = {
      LUMEN_ALERT_EMAIL_TO: "owner@example.com",
      LUMEN_ALERT_EMAIL_FROM: "lumen@example.com",
      LUMEN_SMTP_HOST: "smtp.example.com",
      LUMEN_ALERT_TELEGRAM_BOT_TOKEN: "bot-token",
      LUMEN_ALERT_TELEGRAM_CHAT_ID: "4242",
    };
    const built = buildOwnerNotifier(env, {
      sendMail: (message) => mail.push(message.to),
      sendTelegram: (message) => telegram.push(message.chatId),
    });
    expect(built.externalConfigured).toBe(true);
    expect(built.channels).toEqual(["email", "telegram"]);
    built.notifier.notify({ kind: "dispute", title: "New dispute", detail: "du_1" });
    expect(mail).toEqual(["owner@example.com"]);
    expect(telegram).toEqual(["4242"]);
    expect(buildOwnerNotifier({}).externalConfigured).toBe(false);
    expect(REQUIRE_HARD_CAPS_WHEN_SPENDING).toBe(false);
  });

  it("refuses SMTP auth before TLS and records a failed alert delivery", async () => {
    const received: string[] = [];
    const server = net.createServer((socket) => {
      socket.write("220 ready\r\n");
      socket.on("data", (chunk) => {
        const line = chunk.toString("utf8");
        received.push(line);
        if (line.startsWith("EHLO")) socket.write("250 zoora\r\n");
        else if (line.startsWith("STARTTLS")) socket.write("454 TLS not available\r\n");
        else socket.write("250 ok\r\n");
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    await expect(deliverSmtp({
      LUMEN_SMTP_HOST: "127.0.0.1",
      LUMEN_SMTP_PORT: String(port),
      LUMEN_SMTP_USER: "mailbox",
      LUMEN_SMTP_PASSWORD: "secret-pass",
      LUMEN_ALERT_EMAIL_FROM: "zoora@example.com",
      LUMEN_ALERT_EMAIL_TO: "owner@example.com",
    }, { from: "zoora@example.com", to: "owner@example.com", subject: "Zoora", text: "hello" })).rejects.toThrow(/SMTP_TLS_REQUIRED/);
    expect(received.join("")).not.toContain("AUTH");
    expect(received.join("")).not.toContain(Buffer.from("secret-pass").toString("base64"));
    server.close();

    const db = openDatabase();
    const now = Date.UTC(2026, 10, 9, 18);
    const original = { kind: "issuer" as const, title: "Issuer outcome unknown", detail: "boom may have charged" };
    reportDeliveryFailure(db, new Error("SMTP_DOWN"), now, original, "email");
    reportDeliveryFailure(db, new Error("TELEGRAM_DOWN"), now, original, "telegram");
    const retries = db.prepare("SELECT title, channel, attempt, next_at FROM alert_retries ORDER BY channel").all() as { title: string; channel: string; attempt: number; next_at: number }[];
    expect(retries.map((row) => row.channel)).toEqual(["email", "telegram"]);
    expect(retries.every((row) => row.title === "Issuer outcome unknown" && row.attempt === 1 && row.next_at > now)).toBe(true);
    const alerts = db.prepare("SELECT title FROM owner_alerts").all() as { title: string }[];
    expect(alerts.map((row) => row.title)).toContain("Alert delivery failed");

    const telegramDb = openDatabase();
    const send = telegramApiTransport(async () => { throw new Error("TELEGRAM_DOWN"); }, (error) => reportDeliveryFailure(telegramDb, error));
    send({ token: "bot", chatId: "1", text: "hi" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const telegramAlerts = telegramDb.prepare("SELECT title FROM owner_alerts").all() as { title: string }[];
    expect(telegramAlerts.map((row) => row.title)).toContain("Alert delivery failed");

    const retryDb = openDatabase();
    const at = Date.UTC(2026, 10, 9, 19);
    const source = { kind: "dispute" as const, title: "New dispute", detail: "du_9" };
    reportDeliveryFailure(retryDb, new Error("SMTP_DOWN"), at, source, "email");
    reportDeliveryFailure(retryDb, new Error("TELEGRAM_DOWN"), at, source, "telegram");
    const sent: string[] = [];
    expect(drainAlertRetries(retryDb, () => undefined, at).sent).toBe(0);
    const due = retryDb.prepare("SELECT next_at FROM alert_retries WHERE channel = 'email'").get() as { next_at: number };
    expect(drainAlertRetries(retryDb, (alert) => { sent.push(alert.title); throw new Error("still down"); }, due.next_at).sent).toBe(0);
    expect(sent.every((title) => title === "New dispute")).toBe(true);
    const bumped = retryDb.prepare("SELECT attempt, next_at FROM alert_retries WHERE channel = 'email'").get() as { attempt: number; next_at: number };
    expect(bumped.attempt).toBe(2);
    expect(bumped.next_at).toBeGreaterThan(due.next_at);
    retryDb.prepare("UPDATE alert_retries SET started_at = ?, next_at = ?").run(at - ALERT_GIVE_UP_MS - 1, due.next_at);
    expect(drainAlertRetries(retryDb, () => { throw new Error("last"); }, due.next_at).gaveUp).toBe(2);
    expect(drainAlertRetries(retryDb, () => { throw new Error("again"); }, due.next_at).gaveUp).toBe(0);
    expect((retryDb.prepare("SELECT COUNT(*) AS n FROM alert_retries").get() as { n: number }).n).toBe(0);
    const gaveUp = (retryDb.prepare("SELECT detail FROM owner_alerts WHERE title = 'Alert delivery gave up' ORDER BY detail").all() as { detail: string }[]);
    expect(gaveUp.map((row) => row.detail)).toEqual(["email: New dispute: du_9", "telegram: New dispute: du_9"]);
    const later = { kind: "issuer" as const, title: "Issuer outcome unknown", detail: "second alert" };
    reportDeliveryFailure(retryDb, new Error("SMTP_DOWN"), at, later, "email");
    retryDb.prepare("UPDATE alert_retries SET started_at = ?, next_at = ? WHERE title = ?").run(at - ALERT_GIVE_UP_MS - 1, due.next_at, later.title);
    expect(drainAlertRetries(retryDb, () => { throw new Error("later"); }, due.next_at).gaveUp).toBe(1);
    const afterLater = (retryDb.prepare("SELECT detail FROM owner_alerts WHERE title = 'Alert delivery gave up'").all() as { detail: string }[]);
    expect(afterLater.map((row) => row.detail)).toContain("email: Issuer outcome unknown: second alert");

    const fresh = openDatabase();
    reportDeliveryFailure(fresh, new Error("SMTP_DOWN"), at, source, "email");
    const when = (fresh.prepare("SELECT next_at FROM alert_retries").get() as { next_at: number }).next_at;
    const delivered: string[] = [];
    expect(drainAlertRetries(fresh, (alert) => { delivered.push(alert.title); }, when).sent).toBe(1);
    expect(delivered).toEqual(["New dispute"]);
    expect((fresh.prepare("SELECT COUNT(*) AS n FROM alert_retries").get() as { n: number }).n).toBe(0);
  });

  it("sends an unknown issuer outcome outside the desk and lets the keeper resolve it", () => {
    const db = openDatabase();
    const atMs = Date.UTC(2026, 10, 9, 20);
    const seen: string[] = [];
    const failing = new MockIssuer();
    failing.authorize = () => { throw new Error("ISSUER_TIMEOUT"); };
    executeIntent(db, intent({ id: "unk-mail", amountCents: 100 }), ctx(), failing, atMs, (alert) => seen.push(`${alert.kind}:${alert.title}`));
    expect(seen).toEqual(["issuer:Issuer outcome unknown"]);
    expect((db.prepare("SELECT title FROM owner_alerts").all() as { title: string }[]).some((row) => row.title === "Issuer outcome unknown")).toBe(true);
    const blocked = executeIntent(db, intent({ id: "while-unknown", amountCents: 100 }), ctx(), new MockIssuer(), atMs);
    expect(blocked.decision.reason).toBe("UNKNOWN_SPEND");
    expect(resolveUnknownClaim(db, "unk-mail", "not_charged", atMs).decision.reason).toBe("CONFIRM_REQUIRED");
    const cleared = resolveUnknownClaim(db, "unk-mail", "not_charged", atMs, { confirm: true });
    expect(cleared.issuerCalled).toBe(false);
    expect(cleared.decision.reason).toBe("OWNER_CLEARED_UNKNOWN");
    const voided = new Ledger(db).list().find((row) => row.idempotencyKey === "void:unk-mail");
    expect(voided?.amountCents).toBe(0);
    expect(voided?.note).toContain("paper-shop");
    const audit = db.prepare("SELECT kind, detail FROM audit").all() as { kind: string; detail: string }[];
    expect(audit.some((row) => row.kind === "resolve_unknown" && row.detail.includes("unk-mail:not_charged:paper-shop:100"))).toBe(true);
    const resumed = executeIntent(db, intent({ id: "after-clear", amountCents: 100 }), ctx(), new MockIssuer(), atMs);
    expect(resumed.decision.outcome).toBe("auto_approve");
    expect(resumed.issuerCalled).toBe(true);

    const other = openDatabase();
    const down = new MockIssuer();
    down.authorize = () => { throw new Error("ISSUER_TIMEOUT"); };
    executeIntent(other, intent({ id: "unk-charged", amountCents: 400 }), ctx(), down, atMs);
    expect(resolveUnknownClaim(other, "unk-charged", "charged", atMs, { confirm: true }).decision.reason).toBe("NEEDS_PROVIDER_ID");
    const marked = resolveUnknownClaim(other, "unk-charged", "charged", atMs, { confirm: true, providerTransactionId: "pc_kept", provider: "issuer" });
    expect(marked.issuerCalled).toBe(false);
    expect(marked.decision.reason).toBe("OWNER_ATTESTED_CHARGE");
    expect(marked.row?.note).toContain("paper-shop");
    expect(marked.row?.providerTransactionId).toBe("pc_kept");
    expect(compareRecords(new Ledger(other).list(), [{ provider: "issuer", providerTransactionId: "pc_kept", amountCents: 400, kind: "purchase" }], ["issuer"], ["purchase"])).toEqual([]);

    const quiet = openDatabase();
    const quietDown = new MockIssuer();
    quietDown.authorize = () => { throw new Error("ISSUER_TIMEOUT"); };
    executeIntent(quiet, intent({ id: "unk-quiet", amountCents: 400 }), ctx(), quietDown, atMs);
    const attested = resolveUnknownClaim(quiet, "unk-quiet", "charged", atMs, { confirm: true, unknownId: true });
    expect(attested.row?.providerTransactionId).toBe("unknown");
    expect(attested.row?.note).toContain("id:unknown");
    expect(compareRecords(new Ledger(quiet).list(), [{ provider: "issuer", providerTransactionId: "pc_real", amountCents: 400, kind: "purchase", merchant: "paper-shop", atMs }], ["issuer"], ["purchase"])).toEqual([]);
    expect(deskClock(Date.UTC(2026, 10, 9, 18, 30))).toBe("Nov 9, 12:30 Chicago · 2026-11-09T18:30:00Z");
  });

  it("books a charged unknown outcome under the configured issuer and matches one same-merchant charge", () => {
    const db = openDatabase();
    const atMs = Date.UTC(2026, 10, 9, 21);
    const shop = ctx({ rules: rules({ merchants: ["shop.example.com"], productMerchants: { art_supplies: "shop.example.com" } }) });
    const down = new MockIssuer();
    down.authorize = () => { throw new Error("ISSUER_TIMEOUT"); };
    executeIntent(db, intent({ id: "unk-shop", amountCents: 500, merchant: "shop.example.com" }), shop, down, atMs);
    expect(resolutionProvider(undefined, "privacy")).toBe("privacy");
    expect(resolutionProvider("", "privacy")).toBe("privacy");
    const booked = resolveUnknownClaim(db, "unk-shop", "charged", atMs, { confirm: true, unknownId: true, configuredIssuer: "privacy" });
    expect(booked.row?.provider).toBe("privacy");
    expect(booked.row?.merchant).toBe("shop.example.com");
    expect(booked.row?.provider).not.toBe("issuer");
    const rows = new Ledger(db).list();
    const charge = { provider: "privacy", amountCents: 500, kind: "purchase" as const, merchant: "shop.example.com", atMs };
    const two = compareRecords(rows, [
      { ...charge, providerTransactionId: "pc_1" },
      { ...charge, providerTransactionId: "pc_2" },
    ], ["privacy"], ["purchase"]);
    expect(two).toEqual([{ code: "PROVIDER_ONLY", provider: "privacy", providerTransactionId: "pc_2", detail: "Provider purchase is missing from the ledger." }]);
    expect(compareRecords(rows, [{ ...charge, providerTransactionId: "pc_other", merchant: "other.example.com" }], ["privacy"], ["purchase"])[0]?.code).toBe("PROVIDER_ONLY");
    expect(compareRecords(rows, [{ ...charge, providerTransactionId: "pc_late", atMs: atMs + 73 * 60 * 60 * 1000 }], ["privacy"], ["purchase"])[0]?.code).toBe("PROVIDER_ONLY");
  });

  it("matches a merchant name after case and suffix normalization", () => {
    expect(normalizeMerchant("PAPER SHOP INC")).toBe(normalizeMerchant("paper-shop"));
    expect(normalizeMerchant("Paper Shop, Inc.")).toBe("paper-shop");
    const db = openDatabase();
    const atMs = Date.UTC(2026, 10, 9, 22);
    new Ledger(db).append({
      id: "norm-1",
      atMs,
      kind: "purchase",
      amountCents: 500,
      status: "unconfirmed",
      provider: "privacy",
      providerTransactionId: "unknown",
      idempotencyKey: "exec:norm",
      ref: "norm",
      note: "art_supplies at paper-shop. id:unknown.",
      merchant: "paper-shop",
    });
    const matched = compareRecords(new Ledger(db).list(), [{
      provider: "privacy",
      providerTransactionId: "pc_norm",
      amountCents: 500,
      kind: "purchase",
      merchant: "PAPER SHOP INC",
      atMs,
    }], ["privacy"], ["purchase"]);
    expect(matched).toEqual([]);
  });

  it("backfills merchant from the old note and hashes it into the chain", () => {
    expect(merchantFromLegacyNote("Reserved before issuer. art_supplies at shop.example.com.")).toBe("shop.example.com");
    expect(merchantFromLegacyNote("art_supplies at paper-shop. Expression need is above 0.85.")).toBe("paper-shop");
    expect(merchantFromLegacyNote("Look at the water. Then leave.")).toBeNull();
    expect(merchantFromLegacyNote("Checked at dawn. Reserved before issuer. art_supplies at paper-shop.")).toBeNull();
    const db = openDatabase();
    const note = "Reserved before issuer. art_supplies at shop.example.com.";
    const legacy = createHash("sha256").update(canonical({
      kind: "approval",
      amountCents: 100,
      status: "intent",
      provider: null,
      providerTransactionId: null,
      chargeId: null,
      paymentIntentId: null,
      ref: "old-1",
      note,
    })).digest("hex");
    const entry = createHash("sha256").update(`GENESIS${legacy}`).digest("hex");
    db.prepare(
      `INSERT INTO ledger_entries
        (id, at_ms, kind, amount_cents, currency, status, provider, provider_transaction_id, charge_id, payment_intent_id, idempotency_key, body_hash, ref, note, merchant, prev_hash, entry_hash)
       VALUES (?, ?, 'approval', 100, 'usd', 'intent', NULL, NULL, NULL, NULL, ?, ?, 'old-1', ?, NULL, 'GENESIS', ?)`,
    ).run("old-1", Date.UTC(2026, 10, 1), "reserve:old-1", legacy, note, entry);
    kvSet(db, "ledger_hash_version", "1");
    migrateMerchantHashes(db);
    const row = new Ledger(db).list()[0];
    expect(row?.merchant).toBe("shop.example.com");
    expect(row?.bodyHash).toBe(bodyHash(row!));
    expect(verifyLedgerChain(db)).toBe(true);
    expect(bodyHash({ ...row!, merchant: "paper-shop" })).not.toBe(row?.bodyHash);
  });

  it("refuses a merchant-hash migration when a pre-upgrade row was tampered", () => {
    const db = openDatabase();
    const note = "Reserved before issuer. art_supplies at paper-shop.";
    const legacy = createHash("sha256").update(canonical({
      kind: "approval",
      amountCents: 100,
      status: "intent",
      provider: null,
      providerTransactionId: null,
      chargeId: null,
      paymentIntentId: null,
      ref: "old-2",
      note,
    })).digest("hex");
    const entry = createHash("sha256").update(`GENESIS${legacy}`).digest("hex");
    db.prepare(
      `INSERT INTO ledger_entries
        (id, at_ms, kind, amount_cents, currency, status, provider, provider_transaction_id, charge_id, payment_intent_id, idempotency_key, body_hash, ref, note, merchant, prev_hash, entry_hash)
       VALUES (?, ?, 'approval', 100, 'usd', 'intent', NULL, NULL, NULL, NULL, ?, ?, 'old-2', ?, NULL, 'GENESIS', ?)`,
    ).run("old-2", Date.UTC(2026, 10, 2), "reserve:old-2", legacy, note, entry);
    db.exec("DROP TRIGGER IF EXISTS ledger_no_update");
    db.prepare("UPDATE ledger_entries SET note = ? WHERE id = ?").run("Tampered note.", "old-2");
    db.exec("CREATE TRIGGER IF NOT EXISTS ledger_no_update BEFORE UPDATE ON ledger_entries BEGIN SELECT RAISE(ABORT, 'append-only'); END");
    kvSet(db, "ledger_hash_version", "1");
    migrateMerchantHashes(db);
    expect((db.prepare("SELECT value FROM kv WHERE key = 'ledger_hash_version'").get() as { value: string }).value).toBe("1");
    expect((db.prepare("SELECT note FROM ledger_entries WHERE id = 'old-2'").get() as { note: string }).note).toBe("Tampered note.");
    expect((db.prepare("SELECT title FROM owner_alerts WHERE title = 'Ledger chain broken'").get() as { title: string }).title).toBe("Ledger chain broken");
  });

  it("sends a broken ledger chain through email and Telegram", () => {
    const db = openDatabase();
    const mail: string[] = [];
    const telegram: string[] = [];
    const env = {
      LUMEN_ALERT_EMAIL_TO: "owner@example.com",
      LUMEN_ALERT_EMAIL_FROM: "zoora@example.com",
      LUMEN_SMTP_HOST: "smtp.example.com",
      LUMEN_ALERT_TELEGRAM_BOT_TOKEN: "bot",
      LUMEN_ALERT_TELEGRAM_CHAT_ID: "1",
    };
    notifyChainBroken(db, env, {
      sendMail: (message) => { mail.push(message.subject); },
      sendTelegram: (message) => { telegram.push(message.text); },
    });
    expect(mail).toEqual(["Zoora: Ledger chain broken"]);
    expect(telegram[0]).toContain("Ledger chain broken");
    expect(telegram[0]).toContain("Merchant hashes were not rewritten");
    notifyChainBroken(db, env, { sendMail: () => { mail.push("again"); } });
    expect(mail).toEqual(["Zoora: Ledger chain broken"]);
  });

  it("writes a new give-up notice when the same alert gives up again 3 hours later", () => {
    const db = openDatabase();
    const at = Date.UTC(2026, 10, 9, 12);
    const source = { kind: "dispute" as const, title: "New dispute", detail: "du_again" };
    const giveUp = (when: number) => {
      reportDeliveryFailure(db, new Error("down"), when, source, "email");
      db.prepare("UPDATE alert_retries SET started_at = ?, next_at = ? WHERE channel = 'email' AND detail = ?").run(when - ALERT_GIVE_UP_MS - 1, when, source.detail);
      expect(drainAlertRetries(db, () => { throw new Error("last"); }, when).gaveUp).toBe(1);
    };
    giveUp(at);
    giveUp(at + 3 * 60 * 60 * 1000);
    const notices = db.prepare("SELECT created_at FROM owner_alerts WHERE title = 'Alert delivery gave up' AND detail = ?").all("email: New dispute: du_again") as { created_at: number }[];
    expect(notices).toHaveLength(2);
    expect(notices[1]!.created_at - notices[0]!.created_at).toBe(3 * 60 * 60 * 1000);
    expect(() => guardAsyncRetry(() => { throw new Error("db down"); })()).not.toThrow();
  });
});

describe("live money", () => {
  it("maps a card descriptor and confirms only a matching issuer transaction", () => {
    expect(mapDescriptor("PAPER SHOP INC", ["paper-shop"])).toBe("paper-shop");
    expect(salesCredentials({ STRIPE_SECRET_KEY: "sk_live_x", STRIPE_WEBHOOK_SECRET: "whsec" })).toBe(true);
    const db = openDatabase();
    const at = Date.UTC(2026, 10, 9, 12);
    const result = executeIntent(db, intent({ id: "exp-1" }), ctx(), new ExpectedIssuer("stripe_issuing"), at);
    expect(result.decision.reason).toBe("EXPECTED_SPEND");
    expect(new Ledger(db).list().some((row) => row.kind === "purchase" && row.status === "confirmed")).toBe(false);
    const secret = "whsec_issuing";
    const post = (id: string, type: string, object: Record<string, unknown>) => {
      const payload = JSON.stringify({ id, type, livemode: true, data: { object } });
      const header = sign(payload, secret, Math.floor(at / 1000));
      return handleStripeWebhook(db, payload, header, secret, at);
    };
    const saved = { spend: process.env.LUMEN_SPEND_ENABLED, issuer: process.env.LUMEN_CARD_ISSUER, key: process.env.STRIPE_ISSUING_KEY };
    process.env.LUMEN_SPEND_ENABLED = "true";
    process.env.LUMEN_CARD_ISSUER = "stripe_issuing";
    process.env.STRIPE_ISSUING_KEY = "sk_test_issuing";
    expect(post("evt_auth", "issuing_authorization.request", { id: "iauth_1", amount: 400, merchant_data: { name: "PAPER SHOP INC" } }).approved).toBe(true);
    expect(post("evt_over", "issuing_authorization.request", { id: "iauth_2", amount: 900, merchant_data: { name: "PAPER SHOP INC" } }).approved).toBe(false);
    expect(post("evt_tx", "issuing_transaction.created", { id: "ipi_1", amount: 400, created: Math.floor(at / 1000), merchant_data: { name: "PAPER SHOP INC" } }).ok).toBe(true);
    const purchase = new Ledger(db).list().find((row) => row.kind === "purchase" && row.status === "confirmed");
    expect(purchase?.providerTransactionId).toBe("ipi_1");
    expect(purchase?.amountCents).toBe(400);
    expect(purchase?.merchant).toBe("paper-shop");
    if (saved.spend === undefined) delete process.env.LUMEN_SPEND_ENABLED; else process.env.LUMEN_SPEND_ENABLED = saved.spend;
    if (saved.issuer === undefined) delete process.env.LUMEN_CARD_ISSUER; else process.env.LUMEN_CARD_ISSUER = saved.issuer;
    if (saved.key === undefined) delete process.env.STRIPE_ISSUING_KEY; else process.env.STRIPE_ISSUING_KEY = saved.key;
  });

  it("does not book the same refund twice when charge.refunded arrives first", () => {
    const db = openDatabase();
    const secret = "whsec_refund_order";
    const now = 1_700_000_000_000;
    const post = (id: string, type: string, object: Record<string, unknown>) => {
      const payload = JSON.stringify({ id, type, livemode: true, data: { object } });
      const header = sign(payload, secret, Math.floor(now / 1000));
      expect(handleStripeWebhook(db, payload, header, secret, now).ok).toBe(true);
    };
    post("evt_bare", "charge.refunded", { id: "ch_bare", amount_refunded: 500, payment_intent: "pi_bare" });
    post("evt_named", "refund.created", { id: "re_bare", amount: 500, charge: "ch_bare", payment_intent: "pi_bare" });
    const refunds = new Ledger(db).list().filter((row) => row.kind === "refund");
    expect(refunds.filter((row) => row.status === "confirmed").map((row) => row.amountCents)).toEqual([500]);
    expect(moneyView(new Ledger(db).list()).refundCents).toBe(500);
  });

  it("keeps the mint key out of this process", async () => {
    expect(mintSwitch({}).reason).toBe("MINT_SIGNER_MISSING");
    expect(mintSwitch({ MINT_SIGNER_URL: "https://signer.example", MINT_PRIVATE_KEY: "secret" }).reason).toBe("KEY_MUST_STAY_IN_SIGNER");
    expect(mintSwitch({ MINT_SIGNER_URL: "https://signer.example", MINT_ENABLED: "false" }).open).toBe(false);
    expect(mintSwitch({ MINT_SIGNER_URL: "https://signer.example" }).reason).toBe("SIGNER_AUTH");
    expect(mintSwitch({ MINT_SIGNER_URL: "https://signer.example", LUMEN_MINT_SIGNER_SECRET: "mint-secret" }).open).toBe(true);
    let body = "";
    let signature = "";
    const minted = await requestMint({ MINT_SIGNER_URL: "https://signer.example", LUMEN_MINT_SIGNER_SECRET: "mint-secret" }, { name: "Dock bell", uri: "https://zoora.ai/piece/1" }, async (_url, init) => {
      body = String(init?.body ?? "");
      signature = new Headers(init?.headers).get("x-lumen-signature") ?? "";
      return new Response(JSON.stringify({ signature: "mainnet-sig" }), { status: 200 });
    });
    expect(minted).toEqual({ ok: true, signature: "mainnet-sig" });
    expect(body).toContain("\"network\":\"mainnet\"");
    expect(signature).toMatch(/^[a-f0-9]{64}$/);
    expect(body).not.toContain("secret");
  });
});
