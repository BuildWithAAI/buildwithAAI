import { moneyView, signedAmount, type LedgerRow } from "./ledger";

const MONEY_KINDS = new Set(["sale", "purchase", "fee", "refund", "reversal", "payout", "dispute"]);

export type PublicBooks = {
  empty: boolean;
  liveMoney: boolean;
  headline: string;
  incomeCents: number | null;
  spendingCents: number | null;
  balanceCents: number | null;
  lines: { kind: string; cents: number }[];
};

/** Public totals from confirmed ledger rows only. Notes, ids, and wallets stay out. Her trades are on the floor page, not here. */
export function publicBooks(rows: LedgerRow[], liveMoney: boolean): PublicBooks {
  const confirmed = rows.filter((row) => row.status === "confirmed" && MONEY_KINDS.has(row.kind) && Number.isFinite(row.amountCents));
  if (!confirmed.length) {
    return {
      empty: true,
      liveMoney,
      headline: liveMoney ? "No transactions yet." : "No transactions yet. Live money is off.",
      incomeCents: null,
      spendingCents: null,
      balanceCents: null,
      lines: [],
    };
  }
  const view = moneyView(rows);
  return {
    empty: false,
    liveMoney,
    headline: liveMoney ? "Confirmed totals from the ledger." : "Confirmed totals from the ledger. Live money is off.",
    incomeCents: view.salesCents + view.cardRefundCents,
    spendingCents: view.purchaseCents + view.feeCents + view.payoutCents + view.buyerRefundCents,
    balanceCents: view.confirmedCents,
    lines: confirmed.slice(-8).map((row) => ({ kind: row.kind, cents: signedAmount(row) })),
  };
}

export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}
