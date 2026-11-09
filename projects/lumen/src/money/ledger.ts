import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export const LEDGER_KINDS = ["purchase", "sale", "fee", "refund", "payout", "approval", "decline", "dispute"] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];

export type LedgerInput = {
  id: string;
  atMs: number;
  kind: LedgerKind;
  amountCents: number;
  status: "intent" | "pending" | "confirmed" | "declined" | "unconfirmed";
  provider?: string | null;
  providerTransactionId?: string | null;
  chargeId?: string | null;
  paymentIntentId?: string | null;
  idempotencyKey: string;
  ref?: string | null;
  note: string;
};

export type LedgerRow = LedgerInput & { seq: number; currency: string; prevHash: string; entryHash: string; bodyHash: string };

const CARDISH = /\b\d{13,19}\b/;

export function canonical(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) out[key] = sortValue((value as Record<string, unknown>)[key]);
    return out;
  }
  return value;
}

export function bodyHash(input: LedgerInput): string {
  return createHash("sha256").update(canonical({
    kind: input.kind,
    amountCents: input.amountCents,
    status: input.status,
    provider: input.provider ?? null,
    providerTransactionId: input.providerTransactionId ?? null,
    chargeId: input.chargeId ?? null,
    paymentIntentId: input.paymentIntentId ?? null,
    ref: input.ref ?? null,
    note: input.note,
  })).digest("hex");
}

export class Ledger {
  constructor(private readonly db: DatabaseSync) {}

  append(input: LedgerInput): LedgerRow {
    if (!LEDGER_KINDS.includes(input.kind)) throw new Error("LEDGER_KIND");
    if (CARDISH.test(input.note) || CARDISH.test(input.providerTransactionId ?? "")) throw new Error("CARD_DATA_REJECTED");
    const hash = bodyHash(input);
    const existing = this.db.prepare("SELECT * FROM ledger_entries WHERE idempotency_key = ?").get(input.idempotencyKey) as Record<string, unknown> | undefined;
    if (existing) {
      if (existing.body_hash !== hash) throw new Error("IDEMPOTENCY_CONFLICT");
      return mapRow(existing);
    }
    const prev = this.db.prepare("SELECT entry_hash FROM ledger_entries ORDER BY seq DESC LIMIT 1").get() as { entry_hash: string } | undefined;
    const prevHash = prev?.entry_hash ?? "GENESIS";
    const entryHash = createHash("sha256").update(prevHash + hash).digest("hex");
    this.db.prepare(
      `INSERT INTO ledger_entries
        (id, at_ms, kind, amount_cents, currency, status, provider, provider_transaction_id, charge_id, payment_intent_id, idempotency_key, body_hash, ref, note, prev_hash, entry_hash)
       VALUES (?, ?, ?, ?, 'usd', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.id,
      input.atMs,
      input.kind,
      input.amountCents,
      input.status,
      input.provider ?? null,
      input.providerTransactionId ?? null,
      input.chargeId ?? null,
      input.paymentIntentId ?? null,
      input.idempotencyKey,
      hash,
      input.ref ?? null,
      input.note,
      prevHash,
      entryHash,
    );
    const row = this.db.prepare("SELECT * FROM ledger_entries WHERE id = ?").get(input.id) as Record<string, unknown>;
    return mapRow(row);
  }

  list(): LedgerRow[] {
    return (this.db.prepare("SELECT * FROM ledger_entries ORDER BY seq ASC").all() as Record<string, unknown>[]).map(mapRow);
  }

  findByIdempotency(key: string): LedgerRow | null {
    const row = this.db.prepare("SELECT * FROM ledger_entries WHERE idempotency_key = ?").get(key) as Record<string, unknown> | undefined;
    return row ? mapRow(row) : null;
  }
}

function mapRow(row: Record<string, unknown>): LedgerRow {
  return {
    seq: Number(row.seq),
    id: String(row.id),
    atMs: Number(row.at_ms),
    kind: row.kind as LedgerRow["kind"],
    amountCents: Number(row.amount_cents),
    status: row.status as LedgerRow["status"],
    provider: (row.provider as string | null) ?? null,
    providerTransactionId: (row.provider_transaction_id as string | null) ?? null,
    chargeId: (row.charge_id as string | null) ?? null,
    paymentIntentId: (row.payment_intent_id as string | null) ?? null,
    idempotencyKey: String(row.idempotency_key),
    ref: (row.ref as string | null) ?? null,
    note: String(row.note),
    currency: String(row.currency),
    prevHash: String(row.prev_hash),
    entryHash: String(row.entry_hash),
    bodyHash: String(row.body_hash),
  };
}

const INFLOW = new Set(["sale"]);
const OUTFLOW = new Set(["purchase", "fee", "refund", "payout"]);

export function signedAmount(row: LedgerRow): number {
  if (row.kind === "dispute") return row.amountCents;
  if (INFLOW.has(row.kind)) return Math.abs(row.amountCents);
  if (OUTFLOW.has(row.kind)) return -Math.abs(row.amountCents);
  return 0;
}

export type MoneyView = {
  confirmedCents: number;
  unconfirmedCents: number;
  salesCents: number;
  purchaseCents: number;
  feeCents: number;
  refundCents: number;
  payoutCents: number;
  disputeCents: number;
};

export function moneyView(rows: LedgerRow[]): MoneyView {
  const view: MoneyView = {
    confirmedCents: 0,
    unconfirmedCents: 0,
    salesCents: 0,
    purchaseCents: 0,
    feeCents: 0,
    refundCents: 0,
    payoutCents: 0,
    disputeCents: 0,
  };
  for (const row of rows) {
    const signed = signedAmount(row);
    if (row.status === "confirmed") {
      view.confirmedCents += signed;
      if (row.kind === "sale") view.salesCents += Math.abs(row.amountCents);
      if (row.kind === "purchase") view.purchaseCents += Math.abs(row.amountCents);
      if (row.kind === "fee") view.feeCents += Math.abs(row.amountCents);
      if (row.kind === "refund") view.refundCents += Math.abs(row.amountCents);
      if (row.kind === "payout") view.payoutCents += Math.abs(row.amountCents);
      if (row.kind === "dispute") view.disputeCents += row.amountCents;
    } else if (row.status === "pending" || row.status === "unconfirmed" || row.status === "intent") {
      view.unconfirmedCents += signed;
    }
  }
  return view;
}
