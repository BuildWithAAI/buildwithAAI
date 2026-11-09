import type { LedgerRow } from "./ledger";

export type ProviderRecord = {
  provider: string;
  providerTransactionId: string;
  paymentIntentId?: string | null;
  amountCents: number;
  kind: string;
};

export type Mismatch = { code: string; provider: string; providerTransactionId: string; detail: string };

const DEFAULT_KINDS = ["sale", "refund", "payout", "dispute", "purchase"];

function idsOfRow(row: LedgerRow): string[] {
  return [row.providerTransactionId, row.chargeId, row.paymentIntentId].filter((id): id is string => Boolean(id));
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
  const relevant = rows.filter((row) => row.status === "confirmed" && row.provider && providers.includes(row.provider) && wanted.has(row.kind) && idsOfRow(row).length > 0 && row.kind !== "dispute");
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
  for (const index of unused) {
    const record = pool[index];
    if (!record) continue;
    mismatches.push({ code: "PROVIDER_ONLY", provider: record.provider, providerTransactionId: record.providerTransactionId, detail: `Provider ${record.kind} is missing from the ledger.` });
  }
  return mismatches;
}
