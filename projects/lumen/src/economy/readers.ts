import { createHmac } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { fetchSolUsd } from "../money/solana";
import { recordReading } from "./economy";

/**
 * Readers ask a venue for its balance and record it. They only read.
 *
 * Bybit: a read-only API key. Before any balance is asked for, the key is checked, and a key that
 * can trade, transfer or withdraw is refused. No order, transfer or withdrawal call exists in this file.
 *
 * Solana wallets (a hardware wallet, Phantom): watched by public address. No key, seed or signature is
 * involved, and nothing here can move a coin.
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

/** `venue=address,venue=address`. A malformed pair is dropped, not guessed at. */
export function parseWatch(raw: string | undefined): { venueId: string; address: string }[] {
  return (raw ?? "")
    .split(",")
    .map((pair) => pair.trim().split("="))
    .filter((pair): pair is [string, string] => pair.length === 2 && VENUE.test(pair[0] ?? "") && ADDRESS.test(pair[1] ?? ""))
    .map(([venueId, address]) => ({ venueId, address }));
}

export type ReaderResult = { venueId: string; ok: boolean; reason: string };

/**
 * Read every configured venue once. One venue failing does not stop the others, and a failure
 * records nothing: the last good reading stands until it goes stale. Reasons are codes, never a key or a body.
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
  const watch = parseWatch(env.ECON_SOL_WATCH);
  if (watch.length) {
    const rpcUrl = env.LUMEN_SOL_RPC_URL ?? "";
    const priceUrl = env.LUMEN_SOL_PRICE_URL ?? "";
    let price: number | null = null;
    try {
      price = rpcUrl.startsWith("https://") && priceUrl ? await fetchSolUsd(priceUrl, fetchImpl) : null;
    } catch {
      price = null;
    }
    for (const item of watch) {
      await attempt(item.venueId, async () => {
        if (!rpcUrl.startsWith("https://")) throw new Error("SOL_RPC_NOT_SET");
        if (price == null) throw new Error("SOL_PRICE");
        return readSolWallet(rpcUrl, item.address, price, fetchImpl);
      });
    }
  }
  return results;
}
