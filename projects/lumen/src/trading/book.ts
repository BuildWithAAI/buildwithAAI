import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { flag, setFlag } from "../db/db";
import { Ledger } from "../money/ledger";
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

export function tradingLive(env: TradeEnv): boolean {
  return env.LUMEN_TRADING_LIVE === "true";
}

export function tradeCaps(env: TradeEnv): { maxTradeCents: number | null; maxDailyLossCents: number | null; maxSlippageBps: number | null; minLiquidityUsd: number } {
  return {
    maxTradeCents: dollarsToCents(env.LUMEN_TRADE_MAX_USD),
    maxDailyLossCents: dollarsToCents(env.LUMEN_TRADE_DAILY_LOSS_USD),
    maxSlippageBps: bps(env.LUMEN_TRADE_MAX_SLIPPAGE_BPS),
    minLiquidityUsd: wholeDollars(env.LUMEN_RUG_LIQUIDITY_USD) ?? 5000,
  };
}

export function evaluateTrade(proposal: TradeProposal, env: TradeEnv, db: DatabaseSync, safety: "ok" | "RUG" | "HONEYPOT" | "UNCHECKED"): TradeDecision {
  if (env.LUMEN_TRADING_PRIVATE_KEY || env.SOLANA_PRIVATE_KEY) return { ok: false, reason: "KEY_IN_APP" };
  if (proposal.influencedByVisitor || proposal.influencedByWeb || proposal.influencedByTelegram) return { ok: false, reason: "INFLUENCE" };
  if (env.LUMEN_KILL_SWITCH === "true" || flag(db, "kill") === "1" || flag(db, "trading_kill") === "1") return { ok: false, reason: "KILL_SWITCH" };
  if (flag(db, "trading_unknown") === "1") return { ok: false, reason: "UNKNOWN" };
  if (!MINT.test(proposal.mint)) return { ok: false, reason: "MINT" };
  const caps = tradeCaps(env);
  if (caps.maxTradeCents == null || caps.maxDailyLossCents == null || caps.maxSlippageBps == null) return { ok: false, reason: "CAP_UNSET" };
  if (proposal.usdCents <= 0 || proposal.usdCents > caps.maxTradeCents) return { ok: false, reason: "CAP" };
  if (proposal.slippageBps > caps.maxSlippageBps) return { ok: false, reason: "SLIPPAGE" };
  const deny = split(env.LUMEN_TRADE_DENY);
  const allow = split(env.LUMEN_TRADE_ALLOW);
  if (deny.includes(proposal.mint)) return { ok: false, reason: "DENY" };
  if (allow.length && !allow.includes(proposal.mint)) return { ok: false, reason: "ALLOW" };
  if (safety === "RUG") return { ok: false, reason: "RUG" };
  if (safety === "HONEYPOT") return { ok: false, reason: "HONEYPOT" };
  if (safety !== "ok") return { ok: false, reason: "UNCHECKED" };
  const loss = dailyLossCents(db);
  if (loss + proposal.usdCents > caps.maxDailyLossCents) return { ok: false, reason: "DAILY_LOSS" };
  if (!tradingLive(env)) return { ok: true, mode: "paper" };
  const signer = env.LUMEN_TRADE_SIGNER_URL ?? "";
  if (!signer.startsWith("https://")) return { ok: false, reason: "NO_SIGNER" };
  return { ok: true, mode: "live" };
}

export type DexPair = {
  priceUsd?: string;
  priceNative?: string;
  liquidity?: { usd?: number };
  labels?: string[];
  baseToken?: { address?: string; symbol?: string };
};

export function parseDexQuote(json: { pairs?: DexPair[] }, mint: string, at: number): { symbol: string; priceUsd: string; priceSol: string; liquidityUsd: number; labels: string[] } | null {
  const pair = (json.pairs ?? []).find((item) => (item.baseToken?.address ?? "").toLowerCase() === mint.toLowerCase()) ?? json.pairs?.[0];
  if (!pair?.priceUsd || !pair.priceNative) return null;
  if (!positive(pair.priceUsd) || !positive(pair.priceNative)) return null;
  return {
    symbol: pair.baseToken?.symbol || "TOKEN",
    priceUsd: pair.priceUsd,
    priceSol: pair.priceNative,
    liquidityUsd: pair.liquidity?.usd ?? 0,
    labels: pair.labels ?? [],
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

export function tape(db: DatabaseSync): { mode: "PAPER" | "LIVE"; quotes: { symbol: string; priceUsd: string; priceSol: string; quotedAt: number }[]; positions: { symbol: string; usdCents: number; solMicro: number }[]; history: { symbol: string; side: string; result: string | null; thesis: string; exitPlan: string; quotedAt: number; mode: string }[]; pnl: { usdCents: number; solMicro: number } } {
  const quotes = db.prepare("SELECT symbol, price_usd, price_sol, quoted_at FROM price_quotes ORDER BY quoted_at DESC LIMIT 6").all() as { symbol: string; price_usd: string; price_sol: string; quoted_at: number }[];
  const open = db.prepare("SELECT symbol, usd_cents, sol_micro FROM paper_trades WHERE status = 'open'").all() as { symbol: string; usd_cents: number; sol_micro: number }[];
  const history = db.prepare("SELECT symbol, side, result, thesis, exit_plan, quoted_at, mode FROM paper_trades ORDER BY created_at DESC LIMIT 8").all() as { symbol: string; side: string; result: string | null; thesis: string; exit_plan: string; quoted_at: number; mode: string }[];
  const closed = db.prepare("SELECT result FROM paper_trades WHERE status = 'closed' AND result IS NOT NULL").all() as { result: string }[];
  let usd = 0;
  let sol = 0;
  for (const row of closed) {
    const parsed = JSON.parse(row.result) as { usdCents?: number; solMicro?: number };
    usd += parsed.usdCents ?? 0;
    sol += parsed.solMicro ?? 0;
  }
  return {
    mode: "PAPER",
    quotes: quotes.map((row) => ({ symbol: row.symbol, priceUsd: row.price_usd, priceSol: row.price_sol, quotedAt: row.quoted_at })),
    positions: open.map((row) => ({ symbol: row.symbol, usdCents: row.usd_cents, solMicro: row.sol_micro })),
    history: history.map((row) => ({ symbol: row.symbol, side: row.side, result: row.result, thesis: row.thesis, exitPlan: row.exit_plan, quotedAt: row.quoted_at, mode: row.mode })),
    pnl: { usdCents: usd, solMicro: sol },
  };
}

export function latestThesis(db: DatabaseSync): string | null {
  const row = db.prepare("SELECT symbol, side, thesis FROM paper_trades ORDER BY created_at DESC LIMIT 1").get() as { symbol: string; side: string; thesis: string } | undefined;
  if (!row) return null;
  return `On paper I ${row.side === "buy" ? "took" : "left"} ${row.symbol} because ${row.thesis} This is my own note, not advice.`;
}

function book(db: DatabaseSync, proposal: TradeProposal, quote: NonNullable<ReturnType<typeof parseDexQuote>>, mode: "paper" | "live", signature: string | null, now: number): string {
  const id = `tr-${randomBytes(4).toString("hex")}`;
  const solMicro = solNotional(proposal.usdCents, quote.priceUsd, quote.priceSol);
  db.prepare(
    `INSERT INTO price_quotes(mint, symbol, price_usd, price_sol, quoted_at) VALUES(?, ?, ?, ?, ?)
     ON CONFLICT(mint) DO UPDATE SET symbol = excluded.symbol, price_usd = excluded.price_usd, price_sol = excluded.price_sol, quoted_at = excluded.quoted_at`,
  ).run(proposal.mint, quote.symbol, quote.priceUsd, quote.priceSol, now);
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

async function askSigner(env: TradeEnv, proposal: TradeProposal, fetchImpl: typeof fetch): Promise<{ ok: true; signature: string } | { ok: false }> {
  const response = await fetchImpl(env.LUMEN_TRADE_SIGNER_URL ?? "", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ instruction: "swap", network: "mainnet", mint: proposal.mint, side: proposal.side, usdCents: proposal.usdCents, maxSlippageBps: proposal.slippageBps }),
  });
  if (!response.ok) return { ok: false };
  const json = (await response.json()) as { signature?: string; unknown?: boolean };
  if (json.unknown || !json.signature) return { ok: false };
  return { ok: true, signature: json.signature };
}

function dailyLossCents(db: DatabaseSync): number {
  const day = new Date().toISOString().slice(0, 10);
  const rows = db.prepare("SELECT result, created_at FROM paper_trades WHERE status = 'closed' AND result IS NOT NULL").all() as { result: string; created_at: number }[];
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
