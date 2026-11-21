export const DAY_MS = 24 * 60 * 60 * 1000;
export const SIMULATED = "SIMULATED, no real money, not financial advice.";
export const PAPER_ASSUMPTIONS = "Paper fills use the DexScreener quote, both the USD price and the native price, at the time of the fill. The paper engine does not subtract slippage or a fee. Closed P&L is the exit quote minus the entry quote.";

export function tokenOldEnough(pairCreatedAt: number | null, now: number): boolean {
  return pairCreatedAt != null && Number.isFinite(pairCreatedAt) && now - pairCreatedAt >= DAY_MS;
}

/** Public pages keep every result, including a loss, except a token younger than a day. */
export function publicHistory<T extends { symbol: string }>(rows: T[], quotes: { symbol: string; pairCreatedAt: number | null }[], now: number): T[] {
  const hidden = new Set(quotes.filter((quote) => !tokenOldEnough(quote.pairCreatedAt, now)).map((quote) => quote.symbol));
  return rows.filter((row) => !hidden.has(row.symbol));
}

export function publicQuotes<T extends { pairCreatedAt: number | null }>(quotes: T[], now: number): T[] {
  return quotes.filter((quote) => tokenOldEnough(quote.pairCreatedAt, now));
}

/** Neutral on-chain facts only. Names and projects are not judged. */
export function neutralRiskFlags(input: { liquidityUnlocked?: boolean; top10Pct?: number | null; contractMutable?: boolean }): string[] {
  const lines: string[] = [];
  if (input.liquidityUnlocked) lines.push("liquidity unlocked");
  if (typeof input.top10Pct === "number" && Number.isFinite(input.top10Pct)) lines.push(`top-10 holders ${Math.round(input.top10Pct)}%`);
  if (input.contractMutable) lines.push("contract mutable");
  return lines;
}
