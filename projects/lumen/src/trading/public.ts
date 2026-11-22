export const DAY_MS = 24 * 60 * 60 * 1000;
export const NOT_ADVICE = "Not financial advice.";
/** Goes wherever a price or a result of hers is shown. Her trades are real ones. */
export const REAL_MONEY = `Real money. ${NOT_ADVICE}`;
/** How the figures on the floor are made, so nobody reads more into them than is there. */
export const FLOOR_NOTES = "Every trade here is a real one. A forex result is the broker's own figure, after its commission and swap. A coin figure is the DexScreener quote at the time of the trade: what the chain gave, with its slippage and fees, is not read back yet, so the true result can differ.";

/** One forex order of hers as the floor shows it. `demo` is a broker's practice account: it is marked and not counted. */
export type FloorFx = {
  mode: "live" | "demo";
  pair: string;
  side: "buy" | "sell";
  lots: string;
  limit: string;
  stop: string;
  target: string;
  status: "sending" | "resting" | "open" | "closed" | "cancelled";
  fill: string | null;
  exit: string | null;
  exitWhy: "stop" | "target" | "other" | null;
  resultCents: number | null;
  thesis: string;
  createdAt: number;
};

/** What the floor page shows: her forex orders and her coin trades. Every figure is from a real trade. */
export type FloorBoard = {
  /** Her orders can reach the broker now. */
  forexLive: boolean;
  /** Her orders can reach the coin signer now. */
  coinsLive: boolean;
  forex: FloorFx[];
  /** Closed forex trades on the real account, added. */
  forexPnlCents: number;
  quotes: { symbol: string; priceUsd: string; priceSol: string; quotedAt: number; pairCreatedAt: number | null }[];
  positions: { symbol: string; usdCents: number; solMicro: number }[];
  history: { symbol: string; side: string; result: string | null; thesis: string; exitPlan: string; quotedAt: number }[];
  pnl: { usdCents: number; solMicro: number };
};

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
