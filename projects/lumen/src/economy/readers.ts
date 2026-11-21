import { createHmac } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { recordReading } from "./economy";

/**
 * Readers ask a venue for its balance and record it. They only read.
 *
 * Bybit: a read-only API key. Before any balance is asked for, the key is checked, and a key that
 * can trade, transfer or withdraw is refused. No order, transfer or withdrawal call exists in this file.
 *
 * Wallets (a hardware wallet, Phantom): watched by public address on Solana, Bitcoin, Ethereum, BNB Chain
 * and Avalanche. No key, seed or signature is involved, and nothing here can move a coin.
 *
 * Prices come from Bybit's public spot tickers, quoted in USDT and counted as dollars.
 */

type Env = Record<string, string | undefined>;
const BYBIT = "https://api.bybit.com";
const RECV_WINDOW = "5000";
const TIMEOUT_MS = 10_000;
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const VENUE = /^[a-z0-9-]{2,40}$/;

export function bybitSign(secret: string, timestamp: string, apiKey: string, query: string): string {
  return createHmac("sha256", secret).update(`${timestamp}${apiKey}${RECV_WINDOW}${query}`).digest("hex");
}

async function bybitGet(path: string, query: string, key: string, secret: string, now: number, fetchImpl: typeof fetch): Promise<Record<string, unknown>> {
  const timestamp = String(now);
  const response = await fetchImpl(`${BYBIT}${path}${query ? `?${query}` : ""}`, {
    headers: { "X-BAPI-API-KEY": key, "X-BAPI-TIMESTAMP": timestamp, "X-BAPI-RECV-WINDOW": RECV_WINDOW, "X-BAPI-SIGN": bybitSign(secret, timestamp, key, query) },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error("BYBIT_HTTP");
  const body = (await response.json()) as { retCode?: number; result?: Record<string, unknown> };
  if (body.retCode !== 0 || !body.result) throw new Error("BYBIT_REFUSED");
  return body.result;
}

/** A key that can do more than read is refused, whatever its balance call would have returned. */
export function bybitKeyIsReadOnly(info: Record<string, unknown>): boolean {
  if (info.readOnly !== 1) return false;
  const permissions = (info.permissions ?? {}) as Record<string, unknown>;
  const wallet = Array.isArray(permissions.Wallet) ? (permissions.Wallet as unknown[]) : [];
  return !wallet.some((item) => /withdraw|transfer/i.test(String(item)));
}

/** Total equity of the unified trading account, in whole cents. The funding wallet is a separate account and is not in this figure. */
export async function readBybit(env: Env, now: number, fetchImpl: typeof fetch = fetch): Promise<number> {
  const key = env.BYBIT_READ_KEY ?? "";
  const secret = env.BYBIT_READ_SECRET ?? "";
  if (!key || !secret) throw new Error("BYBIT_NOT_SET");
  if (!bybitKeyIsReadOnly(await bybitGet("/v5/user/query-api", "", key, secret, now, fetchImpl))) throw new Error("BYBIT_KEY_NOT_READ_ONLY");
  const result = await bybitGet("/v5/account/wallet-balance", "accountType=UNIFIED", key, secret, now, fetchImpl);
  const first = Array.isArray(result.list) ? (result.list[0] as { totalEquity?: unknown } | undefined) : undefined;
  const equity = Number(first?.totalEquity);
  if (!Number.isFinite(equity) || equity < 0) throw new Error("BYBIT_BALANCE");
  return Math.round(equity * 100);
}

async function rpc(url: string, method: string, params: unknown[], fetchImpl: typeof fetch): Promise<unknown> {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error("SOL_RPC_HTTP");
  const body = (await response.json()) as { result?: unknown; error?: unknown };
  if (body.error || body.result === undefined) throw new Error("SOL_RPC_REFUSED");
  return body.result;
}

/** SOL at the given price plus USDC at one dollar, in whole cents. Other tokens and NFTs are not valued. */
export async function readSolWallet(rpcUrl: string, address: string, solUsd: number, fetchImpl: typeof fetch = fetch): Promise<number> {
  if (!ADDRESS.test(address)) throw new Error("SOL_ADDRESS");
  if (!Number.isFinite(solUsd) || solUsd <= 0) throw new Error("SOL_PRICE");
  const balance = (await rpc(rpcUrl, "getBalance", [address, { commitment: "finalized" }], fetchImpl)) as { value?: unknown };
  const lamports = Number(balance.value);
  if (!Number.isSafeInteger(lamports) || lamports < 0) throw new Error("SOL_BALANCE");
  const tokens = (await rpc(rpcUrl, "getTokenAccountsByOwner", [address, { mint: USDC_MINT }, { encoding: "jsonParsed", commitment: "finalized" }], fetchImpl)) as { value?: unknown };
  let usdc = 0;
  for (const account of Array.isArray(tokens.value) ? tokens.value : []) {
    const amount = Number((account as { account?: { data?: { parsed?: { info?: { tokenAmount?: { uiAmount?: unknown } } } } } }).account?.data?.parsed?.info?.tokenAmount?.uiAmount);
    if (Number.isFinite(amount) && amount > 0) usdc += amount;
  }
  return Math.round((lamports / 1_000_000_000) * solUsd * 100 + usdc * 100);
}

export const EVM_CHAINS = { eth: { symbol: "ETH", rpcEnv: "ECON_RPC_ETH" }, bnb: { symbol: "BNB", rpcEnv: "ECON_RPC_BNB" }, avax: { symbol: "AVAX", rpcEnv: "ECON_RPC_AVAX" } } as const;
export type EvmChain = keyof typeof EVM_CHAINS;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const BTC_ADDRESS = /^(bc1[02-9ac-hj-np-z]{20,80}|[13][1-9A-HJ-NP-Za-km-z]{25,39})$/;

export type Watch = { venueId: string; chain: "sol" | "btc" | EvmChain; address: string };

/**
 * `venue=chain:address,venue=chain:address`. Chains: sol, btc, eth, bnb, avax. One venue may have several
 * entries, and its reading is their sum. A malformed entry is dropped, not guessed at.
 */
export function parseWatch(raw: string | undefined): Watch[] {
  const out: Watch[] = [];
  for (const pair of (raw ?? "").split(",")) {
    const [venueId, rest, extra] = pair.trim().split("=");
    if (extra !== undefined || !venueId || !rest || !VENUE.test(venueId)) continue;
    const cut = rest.indexOf(":");
    const chain = cut > 0 ? rest.slice(0, cut) : "";
    const address = cut > 0 ? rest.slice(cut + 1) : "";
    if (chain === "sol" && ADDRESS.test(address)) out.push({ venueId, chain, address });
    else if (chain === "btc" && BTC_ADDRESS.test(address)) out.push({ venueId, chain, address });
    else if (chain in EVM_CHAINS && EVM_ADDRESS.test(address)) out.push({ venueId, chain: chain as EvmChain, address });
  }
  return out;
}

/** Last spot price in USDT from Bybit's public tickers. No key is sent. */
export async function readPrice(symbol: string, fetchImpl: typeof fetch = fetch): Promise<number> {
  if (!/^[A-Z]{2,10}$/.test(symbol)) throw new Error("PRICE_SYMBOL");
  const response = await fetchImpl(`${BYBIT}/v5/market/tickers?category=spot&symbol=${symbol}USDT`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error("PRICE_HTTP");
  const body = (await response.json()) as { retCode?: number; result?: { list?: { lastPrice?: unknown }[] } };
  const price = Number(body.result?.list?.[0]?.lastPrice);
  if (body.retCode !== 0 || !Number.isFinite(price) || price <= 0) throw new Error("PRICE_REFUSED");
  return price;
}

/** The native coin of an EVM chain at the given price, in whole cents. Tokens on the chain are not valued. */
export async function readEvmWallet(rpcUrl: string, address: string, coinUsd: number, fetchImpl: typeof fetch = fetch): Promise<number> {
  if (!EVM_ADDRESS.test(address)) throw new Error("EVM_ADDRESS");
  if (!Number.isFinite(coinUsd) || coinUsd <= 0) throw new Error("PRICE_REFUSED");
  const hex = await rpc(rpcUrl, "eth_getBalance", [address, "latest"], fetchImpl);
  if (typeof hex !== "string" || !/^0x[0-9a-fA-F]{1,64}$/.test(hex)) throw new Error("EVM_BALANCE");
  // Wei are counted exactly, then cut to a millionth of a coin, which is far below a cent.
  const micro = Number(BigInt(hex) / 1_000_000_000_000n);
  return Math.round((micro / 1_000_000) * coinUsd * 100);
}

/** Confirmed bitcoin at one address, from an Esplora-style API such as a self-hosted or public mempool explorer. */
export async function readBtcAddress(apiBase: string, address: string, btcUsd: number, fetchImpl: typeof fetch = fetch): Promise<number> {
  if (!BTC_ADDRESS.test(address)) throw new Error("BTC_ADDRESS");
  if (!Number.isFinite(btcUsd) || btcUsd <= 0) throw new Error("PRICE_REFUSED");
  const response = await fetchImpl(`${apiBase.replace(/\/$/, "")}/address/${address}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error("BTC_HTTP");
  const body = (await response.json()) as { chain_stats?: { funded_txo_sum?: unknown; spent_txo_sum?: unknown } };
  const sats = Number(body.chain_stats?.funded_txo_sum) - Number(body.chain_stats?.spent_txo_sum);
  if (!Number.isSafeInteger(sats) || sats < 0) throw new Error("BTC_BALANCE");
  return Math.round((sats / 100_000_000) * btcUsd * 100);
}

export type ReaderResult = { venueId: string; ok: boolean; reason: string };

/**
 * Read every configured venue once. A wallet venue is the sum of all its watched addresses. If any one
 * of them cannot be read, nothing is recorded for that venue, because a partial sum would understate it:
 * the last good reading stands until it goes stale. One venue failing does not stop the others.
 * Reasons are codes, never a key or a body.
 */
export async function runReaders(db: DatabaseSync, env: Env, now: number, fetchImpl: typeof fetch = fetch): Promise<ReaderResult[]> {
  const results: ReaderResult[] = [];
  const attempt = async (venueId: string, read: () => Promise<number>) => {
    try {
      recordReading(db, { venueId, valueCents: await read(), source: "reader" }, now);
      results.push({ venueId, ok: true, reason: "OK" });
    } catch (error) {
      const reason = error instanceof Error && /^[A-Z_]{3,40}$/.test(error.message) ? error.message : "READ_FAILED";
      results.push({ venueId, ok: false, reason });
    }
  };
  const bybitVenue = env.ECON_BYBIT_VENUE ?? "";
  if (VENUE.test(bybitVenue)) await attempt(bybitVenue, () => readBybit(env, now, fetchImpl));

  const prices = new Map<string, Promise<number>>();
  const price = (symbol: string) => {
    if (!prices.has(symbol)) prices.set(symbol, readPrice(symbol, fetchImpl));
    return prices.get(symbol)!;
  };
  const https = (name: string, missing: string) => {
    const url = env[name] ?? "";
    if (!url.startsWith("https://")) throw new Error(missing);
    return url;
  };
  const byVenue = new Map<string, Watch[]>();
  for (const item of parseWatch(env.ECON_WATCH)) byVenue.set(item.venueId, [...(byVenue.get(item.venueId) ?? []), item]);
  for (const [venueId, items] of byVenue) {
    await attempt(venueId, async () => {
      let total = 0;
      for (const item of items) {
        if (item.chain === "sol") total += await readSolWallet(https("LUMEN_SOL_RPC_URL", "SOL_RPC_NOT_SET"), item.address, await price("SOL"), fetchImpl);
        else if (item.chain === "btc") total += await readBtcAddress(https("ECON_BTC_API", "BTC_API_NOT_SET"), item.address, await price("BTC"), fetchImpl);
        else total += await readEvmWallet(https(EVM_CHAINS[item.chain].rpcEnv, "EVM_RPC_NOT_SET"), item.address, await price(EVM_CHAINS[item.chain].symbol), fetchImpl);
      }
      return total;
    });
  }
  return results;
}
