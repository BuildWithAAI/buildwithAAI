import type { DatabaseSync } from "node:sqlite";
import type { PurchaseIntent } from "../brain/types";
import { Ledger } from "./ledger";
import { normalizeMerchant } from "./reconcile";
import type { Env } from "./rules";

const DAY = 24 * 60 * 60 * 1000;

export type ExpectedSpend = {
  intentId: string;
  merchant: string;
  maxCents: number;
  expiresAt: number;
  status: string;
};

/** Map a card descriptor onto an allowlisted merchant. `PAPER SHOP INC` matches `paper-shop`. */
export function mapDescriptor(descriptor: string, allowlist: string[], explicit: Record<string, string> = {}): string | null {
  const named = normalizeMerchant(descriptor);
  if (!named) return null;
  if (explicit[named]) return explicit[named];
  return allowlist.find((merchant) => normalizeMerchant(merchant) === named) ?? null;
}

export function descriptorMap(env: Env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (env.LUMEN_DESCRIPTOR_MAP ?? "").split(",")) {
    const [raw, merchant] = part.split(":").map((item) => item.trim());
    if (!raw || !merchant) continue;
    out[normalizeMerchant(raw)] = merchant;
  }
  return out;
}

export function cardCredentials(env: Env): boolean {
  const issuer = env.LUMEN_CARD_ISSUER;
  if (issuer === "mock") return true;
  if (issuer === "stripe_issuing") return issuingKeySeparate(env);
  if (issuer === "privacy") return Boolean(env.PRIVACY_API_KEY);
  if (issuer === "owner_checkout") return true;
  return false;
}

export function issuingKeySeparate(env: Env): boolean {
  const key = env.STRIPE_ISSUING_KEY ?? "";
  const sales = env.STRIPE_SECRET_KEY ?? "";
  if (!key.startsWith("sk_")) return false;
  if (sales && key === sales) return false;
  return true;
}

export function issuingKey(env: Env): string {
  if (env.LUMEN_CARD_ISSUER !== "stripe_issuing" || !issuingKeySeparate(env)) return "";
  const key = env.STRIPE_ISSUING_KEY ?? "";
  return key.startsWith("sk_live_") || key.startsWith("sk_test_") ? key : "";
}

export function openExpectedSpend(db: DatabaseSync, intent: PurchaseIntent, now: number): void {
  db.prepare(
    `INSERT INTO expected_spends(intent_id, merchant, max_cents, expires_at, status, created_at)
     VALUES(?, ?, ?, ?, 'open', ?)
     ON CONFLICT(intent_id) DO NOTHING`,
  ).run(intent.id, intent.merchant, intent.amountCents, now + DAY, now);
}

export function matchExpectedSpend(db: DatabaseSync, merchant: string, amountCents: number, now: number): ExpectedSpend | null {
  const rows = db.prepare("SELECT intent_id, merchant, max_cents, expires_at, status FROM expected_spends WHERE status IN ('open', 'authorized')").all() as {
    intent_id: string; merchant: string; max_cents: number; expires_at: number; status: string;
  }[];
  const named = normalizeMerchant(merchant);
  const hit = rows.find((row) => normalizeMerchant(row.merchant) === named && amountCents <= row.max_cents && row.expires_at >= now && row.status === "open");
  if (!hit) return null;
  return { intentId: hit.intent_id, merchant: hit.merchant, maxCents: hit.max_cents, expiresAt: hit.expires_at, status: hit.status };
}

export function decideAuthorization(db: DatabaseSync, merchant: string, amountCents: number, now: number, gate: { killed: boolean; spendOpen: boolean; unknown: boolean } = { killed: false, spendOpen: true, unknown: false }): boolean {
  if (gate.killed || !gate.spendOpen || gate.unknown || amountCents <= 0) return false;
  const hit = matchExpectedSpend(db, merchant, amountCents, now);
  if (!hit) return false;
  const changed = db.prepare("UPDATE expected_spends SET status = 'authorized' WHERE intent_id = ? AND status = 'open'").run(hit.intentId);
  return Number(changed.changes) === 1;
}

/**
 * Stripe Issuing: `type` is `capture` or `refund`. Captures are negative.
 * A refund is a positive amount. A refund reversal is `type: refund` with a
 * negative amount, and is booked as a reversal. Neither consumes an expected spend.
 */
export function confirmIssuerTransaction(db: DatabaseSync, input: { transactionId: string; merchant: string; amountCents: number; atMs: number; provider: string; transactionType?: string }): { booked: boolean; matched: boolean } {
  const cents = Math.abs(input.amountCents);
  if (!input.transactionId || !Number.isInteger(input.amountCents) || cents <= 0) return { booked: false, matched: false };
  if (input.transactionType === "refund" && input.amountCents < 0) {
    const ledger = new Ledger(db);
    const key = `issuing-reversal:${input.transactionId}`;
    if (!ledger.findByIdempotency(key)) {
      ledger.append({
        id: `reversal-${input.transactionId}`,
        atMs: input.atMs,
        kind: "reversal",
        amountCents: cents,
        status: "confirmed",
        provider: input.provider,
        providerTransactionId: input.transactionId,
        idempotencyKey: key,
        note: `Issuer refund reversal ${input.transactionId}.`,
        merchant: input.merchant,
      });
    }
    return { booked: true, matched: false };
  }
  if (input.transactionType === "refund") {
    const ledger = new Ledger(db);
    const key = `issuing-refund:${input.transactionId}`;
    if (!ledger.findByIdempotency(key)) {
      ledger.append({
        id: `refund-${input.transactionId}`,
        atMs: input.atMs,
        kind: "refund",
        amountCents: cents,
        status: "confirmed",
        provider: input.provider,
        providerTransactionId: input.transactionId,
        idempotencyKey: key,
        note: `Issuer refund ${input.transactionId}.`,
        merchant: input.merchant,
      });
    }
    return { booked: true, matched: false };
  }
  if (input.transactionType !== "capture") return { booked: false, matched: false };
  const rows = db.prepare("SELECT intent_id, merchant, max_cents, expires_at, status FROM expected_spends WHERE status IN ('open', 'authorized')").all() as {
    intent_id: string; merchant: string; max_cents: number; expires_at: number; status: string;
  }[];
  const named = normalizeMerchant(input.merchant);
  const hit = rows.find((row) => normalizeMerchant(row.merchant) === named && cents <= row.max_cents);
  const ledger = new Ledger(db);
  const key = hit ? `exec:${hit.intent_id}` : `issuing:${input.transactionId}`;
  if (!ledger.findByIdempotency(key)) {
    const row = ledger.append({
      id: hit ? `purchase-${hit.intent_id}` : `purchase-${input.transactionId}`,
      atMs: input.atMs,
      kind: "purchase",
      amountCents: cents,
      status: "confirmed",
      provider: input.provider,
      providerTransactionId: input.transactionId,
      idempotencyKey: key,
      ref: hit?.intent_id ?? null,
      note: hit ? `Issuer reported ${hit.merchant}.` : `Issuer charge ${input.transactionId} had no expected spend.`,
      merchant: hit?.merchant ?? input.merchant,
    });
    if (hit) db.prepare("UPDATE purchase_claims SET state = 'executed', ledger_id = ? WHERE intent_id = ?").run(row.id, hit.intent_id);
  }
  if (hit) db.prepare("UPDATE expected_spends SET status = 'confirmed' WHERE intent_id = ?").run(hit.intent_id);
  return { booked: true, matched: Boolean(hit) };
}

export const PRIVACY_MAX_CENTS = 100_000;

export function bookPrivacyCharge(db: DatabaseSync, input: { transactionId: string; merchant: string; amountCents: number; atMs: number }): { booked: boolean; matched: boolean } {
  return confirmIssuerTransaction(db, { ...input, provider: "privacy", transactionType: "capture" });
}

/** Privacy reports use the server clock. The caller cannot choose the time or exceed the amount cap. A repeated id with a different amount is a conflict. */
export function bookPrivacyReport(db: DatabaseSync, input: { transactionId: string; merchant: string; amountCents: number }, now: number): { ok: true; atMs: number } | { ok: false; error: "REPORT" | "AMOUNT" | "CONFLICT" } {
  const transactionId = input.transactionId.trim();
  const merchant = input.merchant.trim();
  if (!transactionId || !merchant) return { ok: false, error: "REPORT" };
  if (!Number.isInteger(input.amountCents) || input.amountCents < 1 || input.amountCents > PRIVACY_MAX_CENTS) return { ok: false, error: "AMOUNT" };
  const prior = db.prepare("SELECT amount_cents FROM ledger_entries WHERE provider = 'privacy' AND provider_transaction_id = ? AND kind = 'purchase'").get(transactionId) as { amount_cents: number } | undefined;
  if (prior && prior.amount_cents !== input.amountCents) {
    const ledger = new Ledger(db);
    const key = `privacy-conflict:${transactionId}:${input.amountCents}`;
    if (!ledger.findByIdempotency(key)) {
      ledger.append({
        id: `audit-privacy-${transactionId}-${input.amountCents}`,
        atMs: now,
        kind: "audit",
        amountCents: input.amountCents,
        status: "unconfirmed",
        provider: "privacy",
        providerTransactionId: transactionId,
        idempotencyKey: key,
        note: `Privacy transaction ${transactionId} was reported as ${input.amountCents} cents after ${prior.amount_cents} cents.`,
        merchant,
      });
    }
    return { ok: false, error: "CONFLICT" };
  }
  if (!prior) bookPrivacyCharge(db, { transactionId, merchant, amountCents: input.amountCents, atMs: now });
  return { ok: true, atMs: now };
}

export type IssuingActivity = { provider: string; providerTransactionId: string; amountCents: number; kind: string; merchant: string | null; atMs: number | null };

/** Fetch Issuing transactions. The key is an Authorization header only and is not returned. */
export async function listIssuingTransactions(key: string, allowlist: string[], explicit: Record<string, string>, fetchImpl: typeof fetch = fetch): Promise<IssuingActivity[]> {
  if (!key) return [];
  const response = await fetchImpl("https://api.stripe.com/v1/issuing/transactions?limit=100", { headers: { Authorization: `Bearer ${key}` } });
  if (!response.ok) throw new Error("ISSUER_PROVIDER_ERROR");
  const json = (await response.json()) as { data?: { id?: string; amount?: number; created?: number; merchant_data?: { name?: string } }[] };
  return (json.data ?? []).flatMap((row) => {
    if (!row.id || typeof row.amount !== "number") return [];
    const raw = row.merchant_data?.name ?? "";
    return [{
      provider: "stripe_issuing",
      providerTransactionId: row.id,
      amountCents: Math.abs(row.amount),
      kind: "purchase",
      merchant: mapDescriptor(raw, allowlist, explicit),
      atMs: typeof row.created === "number" ? row.created * 1000 : null,
    }];
  });
}
