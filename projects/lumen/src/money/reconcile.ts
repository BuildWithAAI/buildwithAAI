import type { LedgerRow } from "./ledger";

export type ProviderRecord = {
  provider: string;
  providerTransactionId: string;
  paymentIntentId?: string | null;
  amountCents: number;
  kind: string;
  merchant?: string | null;
  atMs?: number | null;
};

export type Mismatch = { code: string; provider: string; providerTransactionId: string; detail: string };

const DEFAULT_KINDS = ["sale", "refund", "payout", "dispute", "purchase"];
const UNKNOWN_WINDOW_MS = 72 * 60 * 60 * 1000;
const MERCHANT_SUFFIX = /-(inc|llc|ltd|corp|company|co)$/;

/** Compare merchants without case, punctuation, or a trailing company suffix. */
export function normalizeMerchant(value: string): string {
  let name = value.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  while (MERCHANT_SUFFIX.test(name)) name = name.replace(MERCHANT_SUFFIX, "");
  return name;
}

/** A keeper attested a charge but the issuer id was not available. Reconciliation must not treat this as a mismatch. */
export const UNKNOWN_PROVIDER_ID = "unknown";

function idsOfRow(row: LedgerRow): string[] {
  return [row.providerTransactionId, row.chargeId, row.paymentIntentId].filter((id): id is string => Boolean(id) && id !== UNKNOWN_PROVIDER_ID);
}

function unknownCharge(row: LedgerRow): boolean {
  return row.kind === "purchase" && (row.providerTransactionId === UNKNOWN_PROVIDER_ID || row.note.includes("id:unknown"));
}

function idsOfRecord(record: ProviderRecord): string[] {
  return [record.providerTransactionId, record.paymentIntentId].filter((id): id is string => Boolean(id));
}

function sharesId(row: LedgerRow, record: ProviderRecord): boolean {
  const theirs = new Set(idsOfRecord(record));
  return idsOfRow(row).some((id) => theirs.has(id));
}

function amountAgrees(row: LedgerRow, record: ProviderRecord): boolean {
  if (row.kind === "dispute" && row.amountCents === 0) return true;
  return record.amountCents === Math.abs(row.amountCents);
}

/**
 * Compare only the kinds that were actually fetched. A payout is not a missing charge,
 * and a sale stored as pi_ matches a charge that points at the same payment intent.
 */
export function compareRecords(rows: LedgerRow[], external: ProviderRecord[], providers: string[], fetchedKinds: string[] = DEFAULT_KINDS): Mismatch[] {
  const wanted = new Set(fetchedKinds);
  const mismatches: Mismatch[] = [];
  const relevant = rows.filter((row) => {
    if (!row.provider || !providers.includes(row.provider) || !wanted.has(row.kind) || row.kind === "dispute" || unknownCharge(row)) return false;
    if (idsOfRow(row).length === 0) return false;
    if (row.kind === "purchase") return row.status === "confirmed" || row.status === "unconfirmed";
    return row.status === "confirmed";
  });
  const pool = external.filter((record) => providers.includes(record.provider) && wanted.has(record.kind) && record.kind !== "dispute");
  const unused = new Set(pool.map((_, index) => index));
  for (const row of relevant) {
    const hit = pool.findIndex((record, index) => unused.has(index) && record.kind === row.kind && sharesId(row, record));
    if (hit < 0) {
      mismatches.push({ code: "LEDGER_ONLY", provider: row.provider ?? "", providerTransactionId: row.providerTransactionId ?? "", detail: `Confirmed ${row.kind} has no matching ${row.kind} record.` });
      continue;
    }
    unused.delete(hit);
    const found = pool[hit];
    if (found && !amountAgrees(row, found)) {
      mismatches.push({ code: "AMOUNT", provider: row.provider ?? "", providerTransactionId: row.providerTransactionId ?? "", detail: "Amount differs." });
    }
  }
  if (wanted.has("dispute")) {
    const disputeRows = rows.filter((row) => row.kind === "dispute" && row.provider && providers.includes(row.provider) && idsOfRow(row).length > 0);
    const disputeRecords = external.filter((record) => record.kind === "dispute" && providers.includes(record.provider));
    const groups = new Map<string, LedgerRow[]>();
    for (const row of disputeRows) {
      const id = row.providerTransactionId ?? "";
      groups.set(id, [...(groups.get(id) ?? []), row]);
    }
    const used = new Set<number>();
    for (const [id, group] of groups) {
      const hit = disputeRecords.findIndex((record, index) => !used.has(index) && (record.providerTransactionId === id || idsOfRecord(record).includes(id)));
      if (hit < 0) {
        mismatches.push({ code: "LEDGER_ONLY", provider: group[0]?.provider ?? "", providerTransactionId: id, detail: "Dispute has no provider record." });
        continue;
      }
      used.add(hit);
      const found = disputeRecords[hit];
      const amounts = group.map((row) => Math.abs(row.amountCents)).filter((amount) => amount > 0);
      if (found && amounts.length > 0 && !amounts.includes(found.amountCents)) {
        mismatches.push({ code: "AMOUNT", provider: found.provider, providerTransactionId: id, detail: "Dispute amount differs." });
      }
    }
    disputeRecords.forEach((record, index) => {
      if (!used.has(index)) mismatches.push({ code: "PROVIDER_ONLY", provider: record.provider, providerTransactionId: record.providerTransactionId, detail: "Provider dispute is missing from the ledger." });
    });
  }
  const unknownLeft = rows.filter(unknownCharge);
  for (const index of unused) {
    const record = pool[index];
    if (!record) continue;
    const merchant = record.merchant ?? "";
    if (record.kind === "purchase" && merchant && record.atMs != null) {
      const named = normalizeMerchant(merchant);
      const slot = unknownLeft.findIndex((row) =>
        named.length > 0
        && normalizeMerchant(row.merchant ?? "") === named
        && Math.abs(row.amountCents) === record.amountCents
        && Math.abs(record.atMs! - row.atMs) <= UNKNOWN_WINDOW_MS);
      if (slot >= 0) {
        unknownLeft.splice(slot, 1);
        continue;
      }
    }
    mismatches.push({ code: "PROVIDER_ONLY", provider: record.provider, providerTransactionId: record.providerTransactionId, detail: `Provider ${record.kind} is missing from the ledger.` });
  }
  return mismatches;
}
