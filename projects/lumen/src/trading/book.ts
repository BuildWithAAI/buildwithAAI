import { liveTradeAllowed, workingFloat } from "../economy/ladder";
import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { flag, setFlag } from "../db/db";
import { Ledger } from "../money/ledger";
import { publicMoneyClosed } from "../money/rules";
import { signerFreshness, signerHeaders } from "../money/signerAuth";
import { vetResearchUrl } from "../research/ssrf";

export type TradeProposal = {
  mint: string;
  symbol: string;
  side: "buy" | "sell";
  usdCents: number;
  thesis: string;
  exitPlan: string;
  slippageBps: number;
  influencedByVisitor: boolean;
  influencedByWeb: boolean;
  influencedByTelegram: boolean;
};

export type TradeEnv = Record<string, string | undefined>;

export type TradeDecision = { ok: true; mode: "paper" | "live" } | { ok: false; reason: string };

const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function tradingLive(env: TradeEnv = process.env): boolean {
  return env.LUMEN_TRADING_LIVE === "true";
}

/**
 * The owner's trading rules, 2026-11-22.
 *
 * - Every trade in a Solana coin is three dollars. She does not choose the size. On forex his rule is 0.01 lot with three
 *   dollars lost at the stop, about 30 pips on a pair quoted in dollars. No forex venue is connected, so that is not in this book yet.
 * - Every trade is a limit order: she names the most she will pay, and it is filled at that price or better or not at all.
 * - Every trade has a stop and a target, set from her own research before she enters. Neither can be moved afterwards.
 *   The stop is acted on by the engine the moment the price is at it or under it, with no say from her.
 * - Her money is her limit. Nothing here needs a setting typed in by hand.
 */
export const TRADE_RULES = {
  /** What one trade is, in cents, unless the owner sets `LUMEN_TRADE_USD`. */
  stakeCents: 300,
  /** How long an order waits for its price before it is cancelled. */
  restMs: 24 * 60 * 60 * 1000,
  /** How far under the stop a live stop sale may fill. A stop is there to get out, so it is given room. */
  stopSlippageBps: 1500,
} as const;

/** What one trade is, in cents: the owner's three dollars, or the figure he has set. */
export function stakeCents(env: TradeEnv): number {
  return dollarsToCents(env.LUMEN_TRADE_USD) ?? TRADE_RULES.stakeCents;
}

/** The limits on one trade. None has to be set: a trade is never larger than the stake unless the owner allows more, and a daily loss limit applies only if he sets one. */
export function tradeCaps(env: TradeEnv): { maxTradeCents: number; maxDailyLossCents: number | null; maxSlippageBps: number; minLiquidityUsd: number } {
  return {
    maxTradeCents: dollarsToCents(env.LUMEN_TRADE_MAX_USD) ?? stakeCents(env),
    maxDailyLossCents: dollarsToCents(env.LUMEN_TRADE_DAILY_LOSS_USD),
    maxSlippageBps: bps(env.LUMEN_TRADE_MAX_SLIPPAGE_BPS) ?? 500,
    minLiquidityUsd: wholeDollars(env.LUMEN_RUG_LIQUIDITY_USD) ?? 5000,
  };
}

function tradingStopped(env: TradeEnv, db: DatabaseSync): boolean {
  return env.LUMEN_KILL_SWITCH === "true" || flag(db, "kill") === "1" || flag(db, "trading_kill") === "1";
}

export function evaluateTrade(proposal: TradeProposal, env: TradeEnv, db: DatabaseSync, safety: "ok" | "RUG" | "HONEYPOT" | "UNCHECKED"): TradeDecision {
  if (env.LUMEN_TRADING_PRIVATE_KEY || env.SOLANA_PRIVATE_KEY) return { ok: false, reason: "KEY_IN_APP" };
  if (proposal.influencedByVisitor || proposal.influencedByWeb || proposal.influencedByTelegram) return { ok: false, reason: "INFLUENCE" };
  if (tradingStopped(env, db)) return { ok: false, reason: "KILL_SWITCH" };
  if (flag(db, "trading_unknown") === "1") return { ok: false, reason: "UNKNOWN" };
  if (!MINT.test(proposal.mint)) return { ok: false, reason: "MINT" };
  const caps = tradeCaps(env);
  if (proposal.usdCents <= 0 || proposal.usdCents > caps.maxTradeCents) return { ok: false, reason: "CAP" };
  if (proposal.slippageBps > caps.maxSlippageBps) return { ok: false, reason: "SLIPPAGE" };
  const deny = split(env.LUMEN_TRADE_DENY);
  const allow = split(env.LUMEN_TRADE_ALLOW);
  if (deny.includes(proposal.mint)) return { ok: false, reason: "DENY" };
  if (allow.length && !allow.includes(proposal.mint)) return { ok: false, reason: "ALLOW" };
  if (safety === "RUG") return { ok: false, reason: "RUG" };
  if (safety === "HONEYPOT") return { ok: false, reason: "HONEYPOT" };
  if (safety !== "ok") return { ok: false, reason: "UNCHECKED" };
  // A daily loss limit is the owner's to set. With none set there is none.
  if (caps.maxDailyLossCents != null && dailyLossCents(db, tradingLive(env) ? "live" : "paper") + proposal.usdCents > caps.maxDailyLossCents) return { ok: false, reason: "DAILY_LOSS" };
  if (!tradingLive(env)) return { ok: true, mode: "paper" };
  if (publicMoneyClosed(env)) return { ok: false, reason: "PUBLIC_MODE" };
  // Live only. The ladder says whether she has earned live trading and how large a trade may be, and a tripped brake closes it.
  const earned = liveTradeAllowed(db, proposal.usdCents);
  if (!earned.ok) return { ok: false, reason: earned.reason };
  const signer = env.LUMEN_TRADE_SIGNER_URL ?? "";
  if (!signer.startsWith("https://")) return { ok: false, reason: "NO_SIGNER" };
  return { ok: true, mode: "live" };
}

export type DexPair = {
  priceUsd?: string;
  priceNative?: string;
  liquidity?: { usd?: number };
  labels?: string[];
  pairCreatedAt?: number;
  baseToken?: { address?: string; symbol?: string };
};

export function parseDexQuote(json: { pairs?: DexPair[] }, mint: string, at: number): { symbol: string; priceUsd: string; priceSol: string; liquidityUsd: number; labels: string[]; pairCreatedAt: number | null } | null {
  const pair = (json.pairs ?? []).find((item) => (item.baseToken?.address ?? "").toLowerCase() === mint.toLowerCase()) ?? json.pairs?.[0];
  if (!pair?.priceUsd || !pair.priceNative) return null;
  if (!positive(pair.priceUsd) || !positive(pair.priceNative)) return null;
  return {
    symbol: pair.baseToken?.symbol || "TOKEN",
    priceUsd: pair.priceUsd,
    priceSol: pair.priceNative,
    liquidityUsd: pair.liquidity?.usd ?? 0,
    labels: pair.labels ?? [],
    pairCreatedAt: typeof pair.pairCreatedAt === "number" ? pair.pairCreatedAt : null,
  };
}

export function judgeQuote(quote: { liquidityUsd: number; labels: string[] } | null, minLiquidityUsd: number): "ok" | "RUG" | "HONEYPOT" | "UNCHECKED" {
  if (!quote) return "UNCHECKED";
  if (quote.labels.some((label) => /honeypot/i.test(label))) return "HONEYPOT";
  if (!Number.isFinite(quote.liquidityUsd) || quote.liquidityUsd < minLiquidityUsd) return "RUG";
  return "ok";
}

export async function fetchQuote(mint: string, env: TradeEnv, fetchImpl: typeof fetch = fetch): Promise<ReturnType<typeof parseDexQuote>> {
  const base = env.LUMEN_DEX_URL ?? "https://api.dexscreener.com/latest/dex/tokens/";
  const url = `${base}${mint}`;
  if (!vetResearchUrl(url).ok) return null;
  const response = await fetchImpl(url);
  if (!response.ok) return null;
  const json = (await response.json()) as { pairs?: DexPair[] };
  return parseDexQuote(json, mint, Date.now());
}

export async function proposeTrade(db: DatabaseSync, env: TradeEnv, proposal: TradeProposal, quote: NonNullable<ReturnType<typeof parseDexQuote>>, now: number, fetchImpl: typeof fetch = fetch): Promise<TradeDecision & { id?: string }> {
  const caps = tradeCaps(env);
  const safety = judgeQuote(quote, caps.minLiquidityUsd);
  const decision = evaluateTrade(proposal, env, db, safety);
  if (!decision.ok) return decision;
  if (decision.mode === "live") {
    const signed = await askSigner(env, proposal, fetchImpl);
    if (!signed.ok) {
      flagUnknown(db, now);
      return { ok: false, reason: "UNKNOWN" };
    }
    book(db, proposal, quote, "live", signed.signature, now);
    return { ok: true, mode: "live", id: signed.signature };
  }
  const id = book(db, proposal, quote, "paper", null, now);
  return { ok: true, mode: "paper", id };
}

export function flagUnknown(db: DatabaseSync, _now: number): void {
  setFlag(db, "trading_unknown", "1");
}

type Quote = NonNullable<ReturnType<typeof parseDexQuote>>;

/** What she sends to trade: the coin, the most she will pay for it, where she is wrong, where she takes her profit, and why. The size is not hers to send. */
export type TradeOrder = {
  mint: string;
  symbol: string;
  /** Prices in dollars for one coin, as decimal text, the way a quote gives them. */
  limitUsd: string;
  stopUsd: string;
  targetUsd: string;
  /** Her research, in her own words. */
  thesis: string;
  influencedByVisitor: boolean;
  influencedByWeb: boolean;
  influencedByTelegram: boolean;
};

export type OrderState = { id: string; mode: "paper" | "live"; mint: string; symbol: string; usdCents: number; limitUsd: string; stopUsd: string; targetUsd: string; /** `filling` and `closing` are an order the signer is being asked about at this moment. */ status: "resting" | "filling" | "open" | "closing" | "closed" | "cancelled"; fillUsd: string | null; exitUsd: string | null; exitWhy: "stop" | "target" | null; resultCents: number | null; thesis: string; createdAt: number; expiresAt: number };
type OrderRow = { id: string; mode: "paper" | "live"; mint: string; symbol: string; usd_cents: number; limit_usd: string; stop_usd: string; target_usd: string; status: OrderState["status"]; fill_usd: string | null; exit_usd: string | null; exit_why: "stop" | "target" | null; result_cents: number | null; thesis: string; created_at: number; expires_at: number };
const orderOf = (row: OrderRow): OrderState => ({ id: row.id, mode: row.mode, mint: row.mint, symbol: row.symbol, usdCents: Number(row.usd_cents), limitUsd: row.limit_usd, stopUsd: row.stop_usd, targetUsd: row.target_usd, status: row.status, fillUsd: row.fill_usd, exitUsd: row.exit_usd, exitWhy: row.exit_why, resultCents: row.result_cents == null ? null : Number(row.result_cents), thesis: row.thesis, createdAt: Number(row.created_at), expiresAt: Number(row.expires_at) });

/** Her orders that are waiting for their price or are in a trade, oldest first. */
export function activeOrders(db: DatabaseSync): OrderState[] {
  return (db.prepare("SELECT * FROM trade_orders WHERE status IN ('resting', 'open') ORDER BY created_at, id").all() as OrderRow[]).map(orderOf);
}

export function getOrder(db: DatabaseSync, id: string): OrderState | null {
  const row = db.prepare("SELECT * FROM trade_orders WHERE id = ?").get(id) as OrderRow | undefined;
  return row ? orderOf(row) : null;
}

/** The same quote at another price: a fill at her limit or her target is booked at that price, with the SOL price moved in step. */
function quoteAt(quote: Quote, usd: number): Quote {
  return { ...quote, priceUsd: String(usd), priceSol: String((Number(quote.priceSol) * usd) / Number(quote.priceUsd)) };
}

function asProposal(order: { mint: string; symbol: string; stopUsd: string; targetUsd: string; thesis: string }, side: "buy" | "sell", usdCents: number, flags: Pick<TradeOrder, "influencedByVisitor" | "influencedByWeb" | "influencedByTelegram">): TradeProposal {
  return { mint: order.mint, symbol: order.symbol, side, usdCents, thesis: order.thesis, exitPlan: `Stop at ${order.stopUsd}. Target at ${order.targetUsd}. Both were set before I entered.`, slippageBps: 0, ...flags };
}
const CLEAN = { influencedByVisitor: false, influencedByWeb: false, influencedByTelegram: false };

/** Buys at a price for an order that is waiting. True if it is now a trade. Live, the signer is told the most she will pay. */
async function fill(db: DatabaseSync, env: TradeEnv, order: OrderState, at: Quote, now: number, fetchImpl: typeof fetch): Promise<boolean> {
  const proposal = asProposal(order, "buy", order.usdCents, CLEAN);
  // The order is taken in hand first, so that two looks at the market can never buy it twice.
  if (Number(db.prepare("UPDATE trade_orders SET status = 'filling' WHERE id = ? AND status = 'resting'").run(order.id).changes) !== 1) return false;
  // The whole gate is asked again at the moment of the fill: the kill switch, the coin's safety, and for a live trade whether her money covers it.
  const decision = evaluateTrade(proposal, env, db, judgeQuote(at, tradeCaps(env).minLiquidityUsd));
  if (!decision.ok || decision.mode !== order.mode) {
    db.prepare("UPDATE trade_orders SET status = 'resting' WHERE id = ? AND status = 'filling'").run(order.id);
    return false;
  }
  let signature: string | null = null;
  if (order.mode === "live") {
    const signed = await askSigner(env, proposal, fetchImpl, { limitUsd: order.limitUsd });
    if (!signed.ok) {
      // Nobody knows whether that buy went through. The order is not tried again, since a second try could buy twice. Live trading waits for the owner.
      flagUnknown(db, now);
      db.prepare("UPDATE trade_orders SET status = 'cancelled', closed_at = ? WHERE id = ? AND status = 'filling'").run(now, order.id);
      return false;
    }
    signature = signed.signature;
  }
  const trade = book(db, proposal, at, order.mode, signature, now);
  db.prepare("UPDATE trade_orders SET status = 'open', fill_usd = ?, filled_at = ?, trade_id = ? WHERE id = ? AND status = 'filling'").run(at.priceUsd, now, trade, order.id);
  return true;
}

/** Sells an open trade at a price, because its stop or its target was reached. True if it is closed. */
async function leave(db: DatabaseSync, env: TradeEnv, order: OrderState, why: "stop" | "target", at: Quote, now: number, fetchImpl: typeof fetch): Promise<boolean> {
  const proceeds = Math.max(0, Math.round((order.usdCents * Number(at.priceUsd)) / Number(order.fillUsd)));
  const proposal = asProposal(order, "sell", proceeds, CLEAN);
  if (Number(db.prepare("UPDATE trade_orders SET status = 'closing' WHERE id = ? AND status = 'open'").run(order.id).changes) !== 1) return false;
  let signature: string | null = null;
  if (order.mode === "live") {
    // A target is a limit sale: no less than her price. A stop is there to get out, so it is sold at once and given room.
    const signed = await askSigner(env, proposal, fetchImpl, why === "target" ? { reason: "target", minUsd: order.targetUsd } : { reason: "stop", maxSlippageBps: TRADE_RULES.stopSlippageBps });
    if (!signed.ok) {
      // The trade stays open, and its stop is tried again once the owner has cleared the pause: selling what is already sold does nothing.
      flagUnknown(db, now);
      db.prepare("UPDATE trade_orders SET status = 'open' WHERE id = ? AND status = 'closing'").run(order.id);
      return false;
    }
    signature = signed.signature;
  }
  book(db, proposal, at, order.mode, signature, now);
  db.prepare("UPDATE trade_orders SET status = 'closed', exit_usd = ?, exit_why = ?, result_cents = ?, closed_at = ? WHERE id = ? AND status = 'closing'").run(at.priceUsd, why, proceeds - order.usdCents, now, order.id);
  return true;
}

export type OrderResult = { ok: true; id: string; mode: "paper" | "live"; status: "resting" | "open" } | { ok: false; reason: string };

/**
 * She places a trade. It is three dollars, at her limit, with her stop and her target, or it is not
 * placed. If the price is already at her limit or under it, it is filled now at that price. Otherwise it
 * waits, and `tradeTick` fills it when the price comes to her.
 */
export async function placeOrder(db: DatabaseSync, env: TradeEnv, order: TradeOrder, quote: Quote, now: number, fetchImpl: typeof fetch = fetch): Promise<OrderResult> {
  const [limit, stop, target] = [Number(order.limitUsd), Number(order.stopUsd), Number(order.targetUsd)];
  const price = /^\d+(\.\d+)?$/;
  if (![order.limitUsd, order.stopUsd, order.targetUsd].every((text) => typeof text === "string" && price.test(text)) || !(stop > 0 && stop < limit && limit < target)) return { ok: false, reason: "LEVELS" };
  const thesis = String(order.thesis ?? "").trim().slice(0, 180);
  if (thesis.length < 8) return { ok: false, reason: "NO_THESIS" };
  const usdCents = stakeCents(env);
  const proposal = asProposal({ ...order, thesis }, "buy", usdCents, order);
  const decision = evaluateTrade(proposal, env, db, judgeQuote(quote, tradeCaps(env).minLiquidityUsd));
  if (!decision.ok) return decision;
  // One trade in a coin at a time.
  if (db.prepare("SELECT id FROM trade_orders WHERE mint = ? AND mode = ? AND status IN ('resting', 'filling', 'open', 'closing')").get(order.mint, decision.mode)) return { ok: false, reason: "ALREADY" };
  if (decision.mode === "live") {
    // Her money is her limit: everything she has in trades and waiting to trade, with this one, must be money she has.
    const out = db.prepare("SELECT COALESCE(SUM(usd_cents), 0) AS cents FROM trade_orders WHERE mode = 'live' AND status IN ('resting', 'filling', 'open', 'closing')").get() as { cents: number };
    if (Number(out.cents) + usdCents > workingFloat(db, now)) return { ok: false, reason: "BALANCE" };
  }
  const id = `ord-${randomBytes(4).toString("hex")}`;
  db.prepare("INSERT INTO trade_orders(id, mode, mint, symbol, usd_cents, limit_usd, stop_usd, target_usd, status, thesis, created_at, expires_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, 'resting', ?, ?, ?)").run(id, decision.mode, order.mint, quote.symbol, usdCents, order.limitUsd, order.stopUsd, order.targetUsd, thesis, now, now + TRADE_RULES.restMs);
  const filled = Number(quote.priceUsd) <= limit && (await fill(db, env, getOrder(db, id)!, quote, now, fetchImpl));
  return { ok: true, id, mode: decision.mode, status: filled ? "open" : "resting" };
}

/**
 * One look at the market for every order she has out. `quoteOf` gives the latest quote for a coin, or
 * nothing if there is none, and an order with no quote is left as it is.
 *
 * - An order that has waited a day for its price is cancelled.
 * - An order whose price has come is filled at her limit.
 * - A trade whose price is at its stop or under it is sold at once, at the price it is now. If the price
 *   fell past the stop between two looks, that lower price is what it is sold at.
 * - A trade whose price is at its target or over it is sold at the target.
 *
 * She is not asked about any of it. While the kill switch is on nothing is done at all.
 */
export async function tradeTick(db: DatabaseSync, env: TradeEnv, quoteOf: (mint: string) => Quote | null | undefined, now: number, fetchImpl: typeof fetch = fetch): Promise<{ filled: number; stopped: number; taken: number; expired: number }> {
  const done = { filled: 0, stopped: 0, taken: 0, expired: 0 };
  if (tradingStopped(env, db)) return done;
  for (const order of activeOrders(db)) {
    // A live trade whose last word from the signer was unclear is left alone until the owner clears it.
    if (order.mode === "live" && flag(db, "trading_unknown") === "1") continue;
    if (order.status === "resting" && now >= order.expiresAt) {
      db.prepare("UPDATE trade_orders SET status = 'cancelled', closed_at = ? WHERE id = ? AND status = 'resting'").run(now, order.id);
      done.expired += 1;
      continue;
    }
    const quote = quoteOf(order.mint);
    if (!quote || !positive(quote.priceUsd) || !positive(quote.priceSol)) continue;
    const priceNow = Number(quote.priceUsd);
    if (order.status === "resting") {
      if (priceNow <= Number(order.limitUsd) && (await fill(db, env, order, quoteAt(quote, Number(order.limitUsd)), now, fetchImpl))) done.filled += 1;
    } else if (priceNow <= Number(order.stopUsd)) {
      if (await leave(db, env, order, "stop", quote, now, fetchImpl)) done.stopped += 1;
    } else if (priceNow >= Number(order.targetUsd)) {
      if (await leave(db, env, order, "target", quoteAt(quote, Number(order.targetUsd)), now, fetchImpl)) done.taken += 1;
    }
  }
  return done;
}

/** Reads a fresh quote for each coin she has an order in, a few at a time, and takes one look at the market. With no orders out it reads nothing. */
export async function watchOrders(db: DatabaseSync, env: TradeEnv, now: number, fetchImpl: typeof fetch = fetch): Promise<{ filled: number; stopped: number; taken: number; expired: number }> {
  const mints = [...new Set(activeOrders(db).map((order) => order.mint))].slice(0, 8);
  const quotes = new Map<string, Quote>();
  for (const mint of mints) {
    try {
      const quote = await fetchQuote(mint, env, fetchImpl);
      if (quote) quotes.set(mint, quote);
    } catch {
      // A quote that cannot be read is no quote. The order waits for the next look.
    }
  }
  return tradeTick(db, env, (mint) => quotes.get(mint), now, fetchImpl);
}

export function tape(db: DatabaseSync, env: TradeEnv = process.env): { mode: "PAPER" | "LIVE"; showLivePnl: boolean; quotes: { symbol: string; priceUsd: string; priceSol: string; quotedAt: number; pairCreatedAt: number | null }[]; positions: { symbol: string; usdCents: number; solMicro: number }[]; history: { symbol: string; side: string; result: string | null; thesis: string; exitPlan: string; quotedAt: number; mode: string }[]; pnl: { usdCents: number; solMicro: number; paperUsdCents: number; paperSolMicro: number; liveUsdCents: number; liveSolMicro: number } } {
  const quotes = db.prepare("SELECT symbol, price_usd, price_sol, quoted_at, pair_created_at FROM price_quotes ORDER BY quoted_at DESC LIMIT 6").all() as { symbol: string; price_usd: string; price_sol: string; quoted_at: number; pair_created_at: number | null }[];
  const open = db.prepare("SELECT symbol, usd_cents, sol_micro FROM paper_trades WHERE status = 'open'").all() as { symbol: string; usd_cents: number; sol_micro: number }[];
  const history = db.prepare("SELECT symbol, side, result, thesis, exit_plan, quoted_at, mode FROM paper_trades ORDER BY created_at DESC LIMIT 8").all() as { symbol: string; side: string; result: string | null; thesis: string; exit_plan: string; quoted_at: number; mode: string }[];
  const closed = db.prepare("SELECT result, mode FROM paper_trades WHERE status = 'closed' AND result IS NOT NULL").all() as { result: string; mode: string }[];
  const totals = { paperUsd: 0, paperSol: 0, liveUsd: 0, liveSol: 0 };
  for (const row of closed) {
    const parsed = JSON.parse(row.result) as { usdCents?: number; solMicro?: number };
    if (row.mode === "live") {
      totals.liveUsd += parsed.usdCents ?? 0;
      totals.liveSol += parsed.solMicro ?? 0;
    } else {
      totals.paperUsd += parsed.usdCents ?? 0;
      totals.paperSol += parsed.solMicro ?? 0;
    }
  }
  const live = tradingLive(env);
  return {
    mode: live ? "LIVE" : "PAPER",
    showLivePnl: live,
    quotes: quotes.map((row) => ({ symbol: row.symbol, priceUsd: row.price_usd, priceSol: row.price_sol, quotedAt: row.quoted_at, pairCreatedAt: row.pair_created_at })),
    positions: open.map((row) => ({ symbol: row.symbol, usdCents: row.usd_cents, solMicro: row.sol_micro })),
    history: history.map((row) => ({ symbol: row.symbol, side: row.side, result: row.result, thesis: row.thesis, exitPlan: row.exit_plan, quotedAt: row.quoted_at, mode: row.mode })),
    pnl: {
      usdCents: totals.paperUsd,
      solMicro: totals.paperSol,
      paperUsdCents: totals.paperUsd,
      paperSolMicro: totals.paperSol,
      liveUsdCents: totals.liveUsd,
      liveSolMicro: totals.liveSol,
    },
  };
}

export function latestThesis(db: DatabaseSync): string | null {
  const row = db.prepare("SELECT symbol, side, thesis, mode FROM paper_trades ORDER BY created_at DESC LIMIT 1").get() as { symbol: string; side: string; thesis: string; mode: string } | undefined;
  if (!row) return null;
  const lead = row.mode === "live" ? "Live, I" : "On paper I";
  return `${lead} ${row.side === "buy" ? "took" : "left"} ${row.symbol} because ${row.thesis} This is my own note, not advice.`;
}

function book(db: DatabaseSync, proposal: TradeProposal, quote: NonNullable<ReturnType<typeof parseDexQuote>>, mode: "paper" | "live", signature: string | null, now: number): string {
  const id = `tr-${randomBytes(4).toString("hex")}`;
  const solMicro = solNotional(proposal.usdCents, quote.priceUsd, quote.priceSol);
  db.prepare(
    `INSERT INTO price_quotes(mint, symbol, price_usd, price_sol, quoted_at, pair_created_at) VALUES(?, ?, ?, ?, ?, ?)
     ON CONFLICT(mint) DO UPDATE SET symbol = excluded.symbol, price_usd = excluded.price_usd, price_sol = excluded.price_sol, quoted_at = excluded.quoted_at, pair_created_at = excluded.pair_created_at`,
  ).run(proposal.mint, quote.symbol, quote.priceUsd, quote.priceSol, now, quote.pairCreatedAt ?? null);
  if (proposal.side === "sell") {
    const open = db.prepare("SELECT id, usd_cents, sol_micro FROM paper_trades WHERE mint = ? AND status = 'open' AND mode = ? ORDER BY created_at ASC LIMIT 1").get(proposal.mint, mode) as { id: string; usd_cents: number; sol_micro: number } | undefined;
    const pnl = open ? { usdCents: proposal.usdCents - open.usd_cents, solMicro: solMicro - open.sol_micro } : { usdCents: 0, solMicro: 0 };
    if (open) db.prepare("UPDATE paper_trades SET status = 'closed', result = ? WHERE id = ?").run(JSON.stringify(pnl), open.id);
  }
  db.prepare(
    `INSERT INTO paper_trades(id, mode, mint, symbol, side, usd_cents, sol_micro, price_usd, price_sol, quoted_at, status, thesis, exit_plan, result, signature, created_at)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
  ).run(id, mode, proposal.mint, quote.symbol, proposal.side, proposal.usdCents, solMicro, quote.priceUsd, quote.priceSol, now, proposal.side === "buy" ? "open" : "closed", proposal.thesis.slice(0, 180), proposal.exitPlan.slice(0, 180), signature, now);
  new Ledger(db).append({
    id: `trade-note-${id}`,
    atMs: now,
    kind: "approval",
    amountCents: 0,
    status: "confirmed",
    idempotencyKey: `trade:${id}`,
    note: `${mode === "paper" ? "PAPER" : "LIVE"} ${proposal.side} ${quote.symbol} at ${quote.priceUsd} USD. Quoted ${new Date(now).toISOString()}. Not advice.`,
  });
  return id;
}

async function askSigner(env: TradeEnv, proposal: TradeProposal, fetchImpl: typeof fetch, more: Record<string, string | number> = {}): Promise<{ ok: true; signature: string } | { ok: false; network?: boolean }> {
  const body = JSON.stringify({ instruction: "swap", network: "mainnet", mint: proposal.mint, side: proposal.side, usdCents: proposal.usdCents, maxSlippageBps: proposal.slippageBps, ...more, ...signerFreshness() });
  const headers = signerHeaders(env.LUMEN_TRADE_SIGNER_SECRET, body);
  if (!headers) return { ok: false };
  try {
    const response = await fetchImpl(env.LUMEN_TRADE_SIGNER_URL ?? "", {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return { ok: false };
    const json = (await response.json()) as { signature?: string; unknown?: boolean };
    if (json.unknown || !json.signature) return { ok: false };
    return { ok: true, signature: json.signature };
  } catch {
    return { ok: false, network: true };
  }
}

function dailyLossCents(db: DatabaseSync, mode: "paper" | "live"): number {
  const day = new Date().toISOString().slice(0, 10);
  const rows = db.prepare("SELECT result, created_at FROM paper_trades WHERE status = 'closed' AND result IS NOT NULL AND mode = ?").all(mode) as { result: string; created_at: number }[];
  return rows.reduce((sum, row) => {
    if (new Date(row.created_at).toISOString().slice(0, 10) !== day) return sum;
    const parsed = JSON.parse(row.result) as { usdCents?: number };
    return sum + Math.max(0, -(parsed.usdCents ?? 0));
  }, 0);
}

function solNotional(usdCents: number, priceUsd: string, priceSol: string): number {
  const usd = Number(priceUsd);
  const sol = Number(priceSol);
  if (!usd || !sol) return 0;
  const solPrice = usd / sol;
  return Math.round((usdCents / 100) / solPrice * 1_000_000);
}

function wholeDollars(raw: string | undefined): number | null {
  const text = (raw ?? "").trim();
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function dollarsToCents(raw: string | undefined): number | null {
  const text = (raw ?? "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const [whole, frac = ""] = text.split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

function bps(raw: string | undefined): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 && value <= 500 ? value : null;
}

function split(raw: string | undefined): string[] {
  return (raw ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

function positive(value: string): boolean {
  const number = Number(value);
  return Number.isFinite(number) && number > 0;
}
