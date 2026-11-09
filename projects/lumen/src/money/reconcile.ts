import type { LedgerRow } from "./ledger";

export type ProviderRecord = {
  provider: string;
  providerTransactionId: string;
  amountCents: number;
  kind: string;
};

export type Mismatch = { code: string; provider: string; providerTransactionId: string; detail: string };

export function compareRecords(rows: LedgerRow[], external: ProviderRecord[], providers: string[]): Mismatch[] {
  const mismatches: Mismatch[] = [];
  const relevant = rows.filter((row) => row.status === "confirmed" && row.provider && providers.includes(row.provider) && row.providerTransactionId);
  const byId = new Map(external.map((record) => [`${record.provider}:${record.providerTransactionId}`, record]));
  for (const row of relevant) {
    const key = `${row.provider}:${row.providerTransactionId}`;
    const found = byId.get(key);
    if (!found) {
      mismatches.push({ code: "LEDGER_ONLY", provider: row.provider ?? "", providerTransactionId: row.providerTransactionId ?? "", detail: "Confirmed ledger row has no provider record." });
      continue;
    }
    if (found.amountCents !== Math.abs(row.amountCents)) {
      mismatches.push({ code: "AMOUNT", provider: row.provider ?? "", providerTransactionId: row.providerTransactionId ?? "", detail: "Amount differs." });
    }
    byId.delete(key);
  }
  for (const record of byId.values()) {
    if (!providers.includes(record.provider)) continue;
    mismatches.push({ code: "PROVIDER_ONLY", provider: record.provider, providerTransactionId: record.providerTransactionId, detail: "Provider record is missing from the ledger." });
  }
  return mismatches;
}
