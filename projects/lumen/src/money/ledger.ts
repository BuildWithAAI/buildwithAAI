import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { buildOwnerNotifier, deskNotifier, type AlertEnv, type MailTransport, type TelegramTransport } from "./notify";

export const LEDGER_KINDS = ["purchase", "sale", "fee", "refund", "reversal", "payout", "approval", "decline", "dispute", "audit"] as const;
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
  merchant?: string | null;
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
    merchant: input.merchant ?? null,
  })).digest("hex");
}

/** Pull a merchant out of a known ledger note. A loose " at " in other text is ignored. */
export function merchantFromLegacyNote(note: string): string | null {
  const templates = [
    /^Reserved before issuer\. [A-Za-z0-9._-]+ at ([A-Za-z0-9._-]+)\.$/,
    /^Issuer declined [A-Za-z0-9._-]+ at ([A-Za-z0-9._-]+)\. Not counted toward caps\.$/,
    /^Not charged\. [A-Za-z0-9._-]+ at ([A-Za-z0-9._-]+)\. Keeper voided the unknown outcome\.$/,
    /^[a-z][a-z0-9._-]* at ([A-Za-z0-9._-]+)\. /,
    /^(?:decline|queue|auto_approve|needs_approval):[A-Z0-9_]+:[A-Za-z0-9._-]+:([A-Za-z0-9._-]+)$/,
  ];
  for (const pattern of templates) {
    const match = pattern.exec(note);
    if (match?.[1]) return match[1];
  }
  return null;
}

export function backfillMerchants(db: DatabaseSync): number {
  const rows = db.prepare("SELECT id, note FROM ledger_entries WHERE merchant IS NULL OR merchant = ''").all() as { id: string; note: string }[];
  if (!rows.length) return 0;
  db.exec("DROP TRIGGER IF EXISTS ledger_no_update");
  const update = db.prepare("UPDATE ledger_entries SET merchant = ? WHERE id = ? AND (merchant IS NULL OR merchant = '')");
  let filled = 0;
  for (const row of rows) {
    const merchant = merchantFromLegacyNote(row.note ?? "");
    if (!merchant) continue;
    update.run(merchant, row.id);
    filled += 1;
  }
  db.exec("CREATE TRIGGER IF NOT EXISTS ledger_no_update BEFORE UPDATE ON ledger_entries BEGIN SELECT RAISE(ABORT, 'append-only'); END");
  return filled;
}

/** Hash used before the merchant column joined the chain. */
export function legacyBodyHash(input: LedgerInput): string {
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

export function verifyLegacyChain(rows: LedgerRow[]): boolean {
  let prev = "GENESIS";
  for (const row of rows) {
    const hash = legacyBodyHash(row);
    if (row.bodyHash !== hash || row.prevHash !== prev) return false;
    const entry = createHash("sha256").update(prev + hash).digest("hex");
    if (row.entryHash !== entry) return false;
    prev = entry;
  }
  return true;
}

const CHAIN_BROKEN = {
  kind: "ledger" as const,
  title: "Ledger chain broken",
  detail: "The pre-upgrade ledger chain did not verify. Merchant hashes were not rewritten.",
};

/** Desk, and email or Telegram when those channels are configured. A second call does not send again. */
export function notifyChainBroken(db: DatabaseSync, env: AlertEnv = process.env, io: { sendMail?: MailTransport; sendTelegram?: TelegramTransport } = {}): void {
  const existing = db.prepare("SELECT id FROM owner_alerts WHERE title = ?").get(CHAIN_BROKEN.title);
  if (existing) return;
  buildOwnerNotifier(env, { desk: deskNotifier(db), db, sendMail: io.sendMail, sendTelegram: io.sendTelegram }).notifier.notify(CHAIN_BROKEN);
}

/** Recompute the chain so the merchant is inside the tamper hash. A broken old chain is left untouched. */
export function migrateMerchantHashes(db: DatabaseSync): void {
  const version = db.prepare("SELECT value FROM kv WHERE key = 'ledger_hash_version'").get() as { value: string } | undefined;
  if (version?.value === "2") return;
  const rows = new Ledger(db).list();
  if (!verifyLegacyChain(rows)) {
    notifyChainBroken(db, process.env);
    return;
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    backfillMerchants(db);
    const filled = new Ledger(db).list();
    db.exec("DROP TRIGGER IF EXISTS ledger_no_update");
    const update = db.prepare("UPDATE ledger_entries SET body_hash = ?, prev_hash = ?, entry_hash = ? WHERE id = ?");
    let prev = "GENESIS";
    for (const row of filled) {
      const hash = bodyHash(row);
      const entry = createHash("sha256").update(prev + hash).digest("hex");
      if (row.bodyHash !== hash || row.prevHash !== prev || row.entryHash !== entry) update.run(hash, prev, entry, row.id);
      prev = entry;
    }
    db.exec("CREATE TRIGGER IF NOT EXISTS ledger_no_update BEFORE UPDATE ON ledger_entries BEGIN SELECT RAISE(ABORT, 'append-only'); END");
    db.prepare("INSERT INTO kv(key, value) VALUES('ledger_hash_version', '2') ON CONFLICT(key) DO UPDATE SET value = '2'").run();
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* already closed */ }
    throw error;
  }
}

export function verifyLedgerChain(db: DatabaseSync): boolean {
  const rows = new Ledger(db).list();
  let prev = "GENESIS";
  for (const row of rows) {
    const hash = bodyHash(row);
    if (hash !== row.bodyHash || row.prevHash !== prev) return false;
    const entry = createHash("sha256").update(prev + hash).digest("hex");
    if (entry !== row.entryHash) return false;
    prev = entry;
  }
  return true;
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
        (id, at_ms, kind, amount_cents, currency, status, provider, provider_transaction_id, charge_id, payment_intent_id, idempotency_key, body_hash, ref, note, merchant, prev_hash, entry_hash)
       VALUES (?, ?, ?, ?, 'usd', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      input.merchant ?? null,
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
    merchant: row.merchant == null || row.merchant === "" ? null : String(row.merchant),
    currency: String(row.currency),
    prevHash: String(row.prev_hash),
    entryHash: String(row.entry_hash),
    bodyHash: String(row.body_hash),
  };
}

const INFLOW = new Set(["sale"]);
const OUTFLOW = new Set(["purchase", "fee", "refund", "reversal", "payout"]);

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
  cogsEstimateCents: number;
  refundCents: number;
  reversalCents: number;
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
    cogsEstimateCents: 0,
    refundCents: 0,
    reversalCents: 0,
    payoutCents: 0,
    disputeCents: 0,
  };
  const confirmedRefunds = new Set(rows.filter((row) => row.kind === "refund" && row.status === "confirmed" && row.chargeId).map((row) => row.chargeId));
  for (const row of rows) {
    const stale = row.kind === "refund" && row.status === "unconfirmed" && row.chargeId && confirmedRefunds.has(row.chargeId) && row.note.includes("without a refund id");
    if (stale) continue;
    const signed = signedAmount(row);
    if (row.status === "confirmed") {
      view.confirmedCents += signed;
      if (row.kind === "sale") view.salesCents += Math.abs(row.amountCents);
      if (row.kind === "purchase") view.purchaseCents += Math.abs(row.amountCents);
      if (row.kind === "fee") view.feeCents += Math.abs(row.amountCents);
      if (row.kind === "refund") view.refundCents += Math.abs(row.amountCents);
      if (row.kind === "reversal") view.reversalCents += Math.abs(row.amountCents);
      if (row.kind === "payout") view.payoutCents += Math.abs(row.amountCents);
      if (row.kind === "dispute") view.disputeCents += row.amountCents;
    } else if (row.status === "pending" || row.status === "unconfirmed" || row.status === "intent") {
      view.unconfirmedCents += signed;
      if (row.kind === "fee" && row.note.startsWith("COGS estimate")) view.cogsEstimateCents += Math.abs(row.amountCents);
    }
  }
  return view;
}
