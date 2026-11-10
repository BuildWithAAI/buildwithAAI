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
  if (issuer === "stripe_issuing") return (env.STRIPE_ISSUING_KEY ?? "").startsWith("sk_");
  if (issuer === "privacy") return Boolean(env.PRIVACY_API_KEY);
  if (issuer === "owner_checkout") return true;
  return false;
}

export function issuingKey(env: Env): string {
  if (env.LUMEN_CARD_ISSUER !== "stripe_issuing") return "";
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

/** A reported issuer transaction is booked once. A matching expected spend is linked; an unmatched charge is still booked. */
export function confirmIssuerTransaction(db: DatabaseSync, input: { transactionId: string; merchant: string; amountCents: number; atMs: number; provider: string }): { booked: boolean; matched: boolean } {
  if (!input.transactionId || input.amountCents <= 0) return { booked: false, matched: false };
  const rows = db.prepare("SELECT intent_id, merchant, max_cents, expires_at, status FROM expected_spends WHERE status IN ('open', 'authorized')").all() as {
    intent_id: string; merchant: string; max_cents: number; expires_at: number; status: string;
  }[];
  const named = normalizeMerchant(input.merchant);
  const hit = rows.find((row) => normalizeMerchant(row.merchant) === named && input.amountCents <= row.max_cents);
  const ledger = new Ledger(db);
  const key = hit ? `exec:${hit.intent_id}` : `issuing:${input.transactionId}`;
  if (!ledger.findByIdempotency(key)) {
    const row = ledger.append({
      id: hit ? `purchase-${hit.intent_id}` : `purchase-${input.transactionId}`,
      atMs: input.atMs,
      kind: "purchase",
      amountCents: input.amountCents,
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

export function bookPrivacyCharge(db: DatabaseSync, input: { transactionId: string; merchant: string; amountCents: number; atMs: number }): { booked: boolean; matched: boolean } {
  return confirmIssuerTransaction(db, { ...input, provider: "privacy" });
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
