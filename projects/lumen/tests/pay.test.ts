import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { PurchaseIntent } from "../src/brain/types";
import { openDatabase } from "../src/db/db";
import { setFlag } from "../src/db/db";
import { executeIntent } from "../src/money/execute";
import { OwnerCheckoutIssuer } from "../src/money/issuers";
import { claimCheckout, CLAIM_MS, enqueueCheckout, expireClaims, listPending, rejectPan, reportCheckout } from "../src/money/checkoutQueue";
import { Ledger } from "../src/money/ledger";
import { evaluatePolicy, type PolicyContext } from "../src/money/policy";
import { cardAvailableCents, type MoneyRules } from "../src/money/rules";
import { fetchFinalized, quoteSolOrder, randomReference, verifySolPayment, type SolTx } from "../src/money/solana";

const isolated = path.join(mkdtempSync(path.join(tmpdir(), "lumen-pay-")), "lumen.sqlite");
process.env.LUMEN_DATA = isolated;

function payDb() {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "lumen-pay-")), "lumen.sqlite");
  return openDatabase(file);
}

const now = Date.UTC(2026, 10, 9, 16);
const price = "https://prices.example/sol";

function rules(): MoneyRules {
  return {
    merchants: ["paper-shop"],
    productTypes: ["art_supplies"],
    channels: ["stripe_checkout"],
    autoApproveCapCents: 1000,
    perPurchaseCapCents: null,
    dailyCapCents: null,
    monthlyCapCents: null,
    productMerchants: {},
    productAmounts: {},
    artPriceCents: null,
    wishGuesses: {},
    cardIssuer: "owner_checkout",
  };
}

function ctx(over: Partial<PolicyContext> = {}): PolicyContext {
  return { rules: rules(), spendOpen: true, killed: false, reconciliationAlert: false, spentTodayCents: 0, spentMonthCents: 0, recentIntentCount: 0, cardAvailableCents: 5000, ...over };
}

function intent(over: Partial<PurchaseIntent> = {}): PurchaseIntent {
  return {
    id: "card-1",
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

function tx(input: { recipient: string; reference: string; delta: number }): SolTx {
  const buyer = randomReference();
  return {
    meta: { err: null, preBalances: [1_000_000_000, 0, 0], postBalances: [1_000_000_000 - input.delta, input.delta, 0] },
    transaction: { message: { accountKeys: [buyer, input.recipient, input.reference] }, signatures: ["sig"] },
  };
}

describe("Solana Pay", () => {
  it("quotes from a live rate and rejects a bad payment", async () => {
    const db = payDb();
    const recipient = randomReference();
    const env = { LUMEN_SOL_RECEIVE_ADDRESS: recipient, LUMEN_SOL_PRICE_URL: price };
    const quoted = await quoteSolOrder(db, env, { kind: "nft", itemId: "nft-1", title: "Dock bell", usdCents: 500 }, now, async () => Response.json({ usd: 150 }));
    expect(quoted.ok).toBe(true);
    if (!quoted.ok) return;
    const row = db.prepare("SELECT reference_key, lamports, recipient FROM sol_orders WHERE id = ?").get(quoted.id) as { reference_key: string; lamports: string; recipient: string };
    const signature = "A".repeat(87);
    expect(verifySolPayment(db, quoted.id, signature, tx({ recipient: randomReference(), reference: row.reference_key, delta: Number(row.lamports) }), now)).toEqual({ ok: false, reason: "RECIPIENT" });
    expect(verifySolPayment(db, quoted.id, signature, tx({ recipient, reference: row.reference_key, delta: 1 }), now)).toEqual({ ok: false, reason: "UNDERPAID" });
    expect(verifySolPayment(db, quoted.id, signature, null, now)).toEqual({ ok: false, reason: "UNFINALIZED" });
    db.prepare("UPDATE sol_orders SET expires_at = ? WHERE id = ?").run(now - 1, quoted.id);
    expect(verifySolPayment(db, quoted.id, signature, null, now)).toEqual({ ok: false, reason: "EXPIRED" });
    db.prepare("UPDATE sol_orders SET expires_at = ? WHERE id = ?").run(now + 60_000, quoted.id);
    expect(verifySolPayment(db, quoted.id, signature, tx({ recipient, reference: row.reference_key, delta: Number(row.lamports) }), now).ok).toBe(true);
    expect(verifySolPayment(db, quoted.id, signature, tx({ recipient, reference: row.reference_key, delta: Number(row.lamports) }), now)).toEqual({ ok: false, reason: "REUSED" });
    const sale = new Ledger(db).list().find((item) => item.kind === "sale");
    expect(sale?.providerTransactionId).toBe(signature);
    expect(sale?.status).toBe("confirmed");
    const missed = await quoteSolOrder(db, env, { kind: "nft", itemId: "nft-2", title: "Again", usdCents: 500 }, now, async () => new Response("no", { status: 500 }));
    expect(missed).toEqual({ ok: false, reason: "NO_PRICE" });
    let body = "";
    await fetchFinalized(price, signature, async (_url, init) => {
      body = String(init?.body ?? "");
      return Response.json({ result: null });
    });
    expect(body).toContain("\"commitment\":\"finalized\"");
    const source = readFileSync(new URL("../src/money/solana.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/private[_ ]?key/i);
    expect(source).not.toMatch(/solUsd\s*=\s*\d/);
  });
});

describe("owner checkout", () => {
  it("queues a claim once, books only a report, and pauses after a timeout", () => {
    expect(cardAvailableCents({})).toBeNull();
    expect(cardAvailableCents({ LUMEN_CARD_AVAILABLE_USD: "25.50" })).toBe(2550);
    expect(evaluatePolicy(intent(), ctx({ cardAvailableCents: null })).reason).toBe("CARD_BALANCE_UNSET");
    expect(evaluatePolicy(intent(), ctx({ cardAvailableCents: 100 })).reason).toBe("CARD_LIMIT");
    expect(evaluatePolicy(intent(), ctx({ killed: true })).reason).toBe("KILL_SWITCH");
    const db = payDb();
    const killed = executeIntent(db, intent({ id: "killed" }), ctx({ killed: true }), new OwnerCheckoutIssuer(), now);
    expect(killed.issuerCalled).toBe(false);
    expect(listPending(db, now)).toEqual([]);
    setFlag(db, "kill", "1");
    expect(enqueueCheckout(db, { LUMEN_KILL_SWITCH: "true" }, intent({ id: "direct" }), now)).toEqual({ ok: false, reason: "KILL_SWITCH" });
    setFlag(db, "kill", "0");
    const queued = executeIntent(db, intent(), ctx(), new OwnerCheckoutIssuer(), now);
    expect(queued.decision.reason).toBe("CHECKOUT_QUEUE");
    expect(new Ledger(db).list().some((row) => row.kind === "purchase")).toBe(false);
    const pending = listPending(db, now);
    expect(pending).toHaveLength(1);
    const first = claimCheckout(db, pending[0]!.id, now);
    expect(first.ok).toBe(true);
    expect(claimCheckout(db, pending[0]!.id, now)).toEqual({ ok: false, reason: "CLAIMED" });
    if (!first.ok) return;
    expect(rejectPan({ pan: "4242424242424242" })).toBe(true);
    expect(reportCheckout(db, { id: first.item.id, claimToken: first.claimToken, ok: true, orderNumber: "o1", amountCents: 400, merchant: "paper-shop", receipt: "4242424242424242" }, now)).toEqual({ ok: false, reason: "PAN_REJECTED" });
    expect(reportCheckout(db, { id: first.item.id, claimToken: first.claimToken, ok: true, orderNumber: "o1", amountCents: 390, merchant: "paper-shop", receipt: "rcpt-1" }, now).ok).toBe(true);
    const purchase = new Ledger(db).list().find((row) => row.kind === "purchase");
    expect(purchase?.amountCents).toBe(390);
    expect(purchase?.providerTransactionId).toBe("rcpt-1");
    const second = executeIntent(db, intent({ id: "card-2" }), ctx(), new OwnerCheckoutIssuer(), now);
    expect(second.decision.reason).toBe("CHECKOUT_QUEUE");
    const again = listPending(db, now)[0];
    expect(again).toBeTruthy();
    const claimed = claimCheckout(db, again!.id, now);
    expect(claimed.ok).toBe(true);
    db.prepare("UPDATE checkout_queue SET claimed_at = ? WHERE id = ?").run(now - CLAIM_MS - 1, again!.id);
    expect(expireClaims(db, now)).toBe(1);
    expect((db.prepare("SELECT state FROM purchase_claims WHERE intent_id = 'card-2'").get() as { state: string }).state).toBe("unknown");
    const paused = executeIntent(db, intent({ id: "card-3" }), ctx({ hourlyIntentLimit: 100 }), new OwnerCheckoutIssuer(), now);
    expect(paused.decision.reason).toBe("UNKNOWN_SPEND");
    expect(paused.issuerCalled).toBe(false);
    const source = readFileSync(new URL("../src/money/checkoutQueue.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/private[_ ]?key/i);
    expect(source.slice(source.indexOf("INSERT INTO checkout_queue"), source.indexOf("INSERT INTO checkout_queue") + 400)).not.toMatch(/pan|cvc|card/i);
  });
});
