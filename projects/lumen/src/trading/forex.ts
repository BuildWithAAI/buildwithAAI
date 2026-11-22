import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { flag } from "../db/db";
import { Ledger } from "../money/ledger";
import { signerFreshness, signerHeaders, signerSignatureOk } from "../money/signerAuth";
import { TRADE_RULES, dailyLossCents, dollarsToCents, tradeCaps, tradingStopped, type TradeEnv } from "./book";

/**
 * Forex in her book. The owner's rules, 2026-11-22:
 *
 * - AUDUSD first, at his broker, whose forex runs on MetaTrader 5.
 * - Every trade is 0.01 lot. She does not choose the size.
 * - Every trade is a limit order: it waits at a better price than the market, and is filled there or not at all.
 * - The stop is where the trade has lost three dollars. On AUDUSD at 0.01 lot that is 30 pips. It is worked
 *   out here. She does not send it and nothing moves it.
 * - The target is hers, from her own research, set before she enters. She may buy or sell.
 *
 * This is the paper book. The engine holds the order and plays it against the broker's own bid and ask,
 * read from the price bridge on the owner's computer (`bridge/mt5_bridge.py`). The bridge reads prices
 * and cannot trade. This file holds no login and no password and sends no order to a broker. Live forex
 * is not built.
 */

/**
 * The pairs she may trade. Only a pair quoted in dollars can be here: its loss at the stop is a fixed
 * number of pips, with no second price needed to turn it into dollars. The digits and the size of one
 * lot are what her arithmetic assumes, and a price feed that reports anything else is not read.
 */
export const FX_PAIRS = {
  AUDUSD: { digits: 5, contract: 100_000 },
} as const;
export type FxPair = keyof typeof FX_PAIRS;
export type FxSide = "buy" | "sell";

function isPair(value: unknown): value is FxPair {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(FX_PAIRS, value);
}

export const FX_RULES = {
  /** One trade, in hundredths of a lot: 0.01 lot. */
  centiLots: 1,
  /** What one trade has lost at its stop, in cents. */
  riskCents: 300,
  /** A newest price older than this is no price to place an order by: the market is shut, or the bridge has stopped. */
  freshMs: 120_000,
  /** The most price changes read in one look. */
  path: 2_000,
} as const;

/** The size of one forex trade and what it loses at its stop: the owner's 0.01 lot and three dollars, or the figures he has set. */
export function fxRules(env: TradeEnv): { centiLots: number; riskCents: number } {
  return { centiLots: centiLots(env.LUMEN_FX_LOTS) ?? FX_RULES.centiLots, riskCents: dollarsToCents(env.LUMEN_FX_RISK_USD) ?? FX_RULES.riskCents };
}

function centiLots(raw: string | undefined): number | null {
  const text = (raw ?? "").trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(text)) return null;
  const [whole, frac = ""] = text.split(".");
  const value = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return value > 0 ? value : null;
}

/**
 * How far the stop is from her entry, in points. A point is the last digit of the price, and ten of them
 * are a pip. It is the distance at which the trade has lost the risk, rounded down so the loss is never more.
 * AUDUSD, 0.01 lot, three dollars: 300 points, which is 30 pips.
 */
export function stopPoints(pair: FxPair, rules: { centiLots: number; riskCents: number }): number {
  const { digits, contract } = FX_PAIRS[pair];
  return Math.floor((rules.riskCents * 10 ** digits) / (rules.centiLots * contract));
}

/** What a move of some points is worth on her size, in cents. On AUDUSD at 0.01 lot a point is a cent and a pip is ten. */
export function pointsToCents(pair: FxPair, lots: number, points: number): number {
  const { digits, contract } = FX_PAIRS[pair];
  return Math.round((points * lots * contract) / 10 ** digits);
}

/** A price as she writes it, such as 0.65250, turned into points. Anything that is not a plain positive price is refused. */
function toPoints(text: unknown, digits: number): number | null {
  if (typeof text !== "string" || !new RegExp(`^\\d{1,6}(\\.\\d{1,${digits}})?$`).test(text)) return null;
  const [whole, frac = ""] = text.split(".");
  const points = Number(whole) * 10 ** digits + Number(frac.padEnd(digits, "0"));
  return Number.isSafeInteger(points) && points > 0 ? points : null;
}

function fromPoints(points: number, digits: number): string {
  const scale = 10 ** digits;
  return `${Math.floor(points / scale)}.${String(points % scale).padStart(digits, "0")}`;
}

/** One price change the bridge saw: when, and the bid and the ask in points. */
export type FxSample = { at: number; bid: number; ask: number };
/** What the bridge answers: the pair, the kind of account its terminal is logged in to, how near the market the broker lets an order sit, and every price change since she last looked, oldest first. */
export type FxFeed = { pair: FxPair; account: "demo" | "real" | "contest"; stopsLevel: number; path: FxSample[] };

/** Reads the bridge's answer. Anything out of shape, a pair whose lot or digits are not what her arithmetic assumes, or a price from the future, and none of it is used. */
export function parseFxFeed(json: unknown, pair: FxPair, now: number): FxFeed | null {
  const body = (json ?? {}) as Record<string, unknown>;
  const spec = FX_PAIRS[pair];
  if (body.ok !== true || body.pair !== pair) return null;
  if (body.digits !== spec.digits || body.contract !== spec.contract) return null;
  const account = body.account;
  if (account !== "demo" && account !== "real" && account !== "contest") return null;
  const stopsLevel = body.stopsLevel;
  if (typeof stopsLevel !== "number" || !Number.isSafeInteger(stopsLevel) || stopsLevel < 0 || stopsLevel > 10_000) return null;
  if (!Array.isArray(body.path) || body.path.length === 0 || body.path.length > FX_RULES.path) return null;
  const path: FxSample[] = [];
  let last = 0;
  for (const item of body.path as unknown[]) {
    if (!Array.isArray(item) || item.length !== 3 || !item.every((value) => typeof value === "number" && Number.isSafeInteger(value) && value > 0)) return null;
    const [at, bid, ask] = item as [number, number, number];
    if (at < last || at > now + 5_000 || ask < bid) return null;
    last = at;
    path.push({ at, bid, ask });
  }
  return { pair, account, stopsLevel, path };
}

/** The bridge's address. It is on this computer, or it is https. Nothing else is called, and an address with a name and password in it is refused. */
export function fxBridgeUrl(env: TradeEnv): string | null {
  let url: URL;
  try {
    url = new URL(env.LUMEN_FX_BRIDGE_URL ?? "");
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  const here = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
  if (url.protocol === "https:" || (url.protocol === "http:" && here)) return url.href;
  return null;
}

/**
 * Asks the bridge for a pair's price changes since a time. The request is signed with the secret the two
 * share, and the answer must be signed with it too and carry the request's own nonce, so a price is only
 * ever believed from her own bridge and an old answer cannot be played back. Anything else is no price.
 */
export async function fetchFxFeed(pair: FxPair, sinceMs: number, env: TradeEnv, now: number, fetchImpl: typeof fetch = fetch): Promise<FxFeed | null> {
  const url = fxBridgeUrl(env);
  const secret = env.LUMEN_FX_BRIDGE_SECRET ?? "";
  if (!url || secret.length < 32) return null;
  const fresh = signerFreshness(now);
  const body = JSON.stringify({ instruction: "quote", pair, sinceMs: Math.max(0, Math.floor(sinceMs)), ...fresh });
  const headers = signerHeaders(secret, body);
  if (!headers) return null;
  const response = await fetchImpl(url, { method: "POST", headers, body, signal: AbortSignal.timeout(4000) });
  if (!response.ok) return null;
  const text = await response.text();
  if (text.length > 200_000 || !signerSignatureOk(secret, text, response.headers.get("x-lumen-signature"))) return null;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  if ((json as { nonce?: unknown } | null)?.nonce !== fresh.nonce) return null;
  return parseFxFeed(json, pair, now);
}

/** What she sends to trade forex: the pair, which way, her limit, her target and why. The size and the stop are not hers to send. */
export type FxOrder = {
  pair: string;
  side: FxSide;
  /** Prices as decimal text, such as 0.65250. */
  limit: string;
  target: string;
  /** Her research, in her own words. */
  thesis: string;
  influencedByVisitor: boolean;
  influencedByWeb: boolean;
  influencedByTelegram: boolean;
};

export type FxOrderState = { id: string; mode: "paper"; pair: FxPair; side: FxSide; lots: string; centiLots: number; riskCents: number; limit: string; stop: string; target: string; status: "resting" | "open" | "closed" | "cancelled"; fill: string | null; exit: string | null; exitWhy: "stop" | "target" | null; resultCents: number | null; thesis: string; createdAt: number; expiresAt: number; /** The time of the last price change this order has been played against. */ seenAt: number; filledAt: number | null; closedAt: number | null };
type FxRow = { id: string; mode: "paper"; pair: FxPair; side: FxSide; centi_lots: number; risk_cents: number; limit_px: string; stop_px: string; target_px: string; status: FxOrderState["status"]; fill_px: string | null; exit_px: string | null; exit_why: "stop" | "target" | null; result_cents: number | null; thesis: string; created_at: number; expires_at: number; seen_at: number; filled_at: number | null; closed_at: number | null };
const lotsText = (centi: number): string => (centi / 100).toFixed(2);
const stateOf = (row: FxRow): FxOrderState => ({ id: row.id, mode: row.mode, pair: row.pair, side: row.side, lots: lotsText(Number(row.centi_lots)), centiLots: Number(row.centi_lots), riskCents: Number(row.risk_cents), limit: row.limit_px, stop: row.stop_px, target: row.target_px, status: row.status, fill: row.fill_px, exit: row.exit_px, exitWhy: row.exit_why, resultCents: row.result_cents == null ? null : Number(row.result_cents), thesis: row.thesis, createdAt: Number(row.created_at), expiresAt: Number(row.expires_at), seenAt: Number(row.seen_at), filledAt: row.filled_at == null ? null : Number(row.filled_at), closedAt: row.closed_at == null ? null : Number(row.closed_at) });

/** Her forex orders that are waiting for their price or are in a trade, oldest first. */
export function activeFxOrders(db: DatabaseSync): FxOrderState[] {
  return (db.prepare("SELECT * FROM fx_orders WHERE status IN ('resting', 'open') ORDER BY created_at, id").all() as FxRow[]).map(stateOf);
}

export function getFxOrder(db: DatabaseSync, id: string): FxOrderState | null {
  const row = db.prepare("SELECT * FROM fx_orders WHERE id = ?").get(id) as FxRow | undefined;
  return row ? stateOf(row) : null;
}

type Influence = Pick<FxOrder, "influencedByVisitor" | "influencedByWeb" | "influencedByTelegram">;
const CLEAN: Influence = { influencedByVisitor: false, influencedByWeb: false, influencedByTelegram: false };
/** A broker password or a signing key does not belong in this app. If one of these is set, forex stays shut. */
const KEYS_NOT_HERS = ["LUMEN_MT5_PASSWORD", "MT5_PASSWORD", "LUMEN_TRADING_PRIVATE_KEY", "SOLANA_PRIVATE_KEY"];

/** Asked when she places a forex order and again when it fills. Forex is on paper whatever the live switch says: no part of this app can send a forex order to a broker. */
export function evaluateFx(env: TradeEnv, db: DatabaseSync, influence: Influence, riskCents: number, now: number): { ok: true; mode: "paper" } | { ok: false; reason: string } {
  if (KEYS_NOT_HERS.some((name) => env[name])) return { ok: false, reason: "KEY_IN_APP" };
  if (influence.influencedByVisitor || influence.influencedByWeb || influence.influencedByTelegram) return { ok: false, reason: "INFLUENCE" };
  if (tradingStopped(env, db)) return { ok: false, reason: "KILL_SWITCH" };
  if (flag(db, "trading_unknown") === "1") return { ok: false, reason: "UNKNOWN" };
  // A daily loss limit is the owner's to set. With none set there is none. If he sets one, it is one limit over coins and forex.
  const limit = tradeCaps(env).maxDailyLossCents;
  if (limit != null && dailyLossCents(db, "paper", now) + riskCents > limit) return { ok: false, reason: "DAILY_LOSS" };
  return { ok: true, mode: "paper" };
}

export type FxOrderResult = { ok: true; id: string; mode: "paper"; status: "resting"; /** Where the book put her stop. */ stop: string } | { ok: false; reason: string };

/**
 * She places a forex trade. It is 0.01 lot, at her limit, with her target, and with a stop the book puts
 * where the trade has lost three dollars, or it is not placed.
 *
 * Her limit has to be a better price than the market: under the ask to buy, over the bid to sell. A limit
 * at the market or through it would be a market order, and a broker refuses it as a limit. So the order
 * always waits, and `fxTick` fills it when the price comes to her.
 */
export function placeFxOrder(db: DatabaseSync, env: TradeEnv, order: FxOrder, feed: FxFeed | null | undefined, now: number): FxOrderResult {
  if (!isPair(order.pair)) return { ok: false, reason: "FX_PAIR" };
  const pair = order.pair;
  if (order.side !== "buy" && order.side !== "sell") return { ok: false, reason: "FX_SIDE" };
  const { digits } = FX_PAIRS[pair];
  const rules = fxRules(env);
  const away = stopPoints(pair, rules);
  if (away < 1) return { ok: false, reason: "FX_RULES" };
  const limit = toPoints(order.limit, digits);
  const target = toPoints(order.target, digits);
  if (limit == null || target == null) return { ok: false, reason: "LEVELS" };
  // Up is the way she profits: a buy gains as the price rises, a sale as it falls.
  const up = order.side === "buy" ? 1 : -1;
  const stop = limit - up * away;
  if (stop <= 0 || (target - limit) * up <= 0) return { ok: false, reason: "LEVELS" };
  const thesis = String(order.thesis ?? "").trim().slice(0, 180);
  if (thesis.length < 8) return { ok: false, reason: "NO_THESIS" };
  const decision = evaluateFx(env, db, order, rules.riskCents, now);
  if (!decision.ok) return decision;
  // With no fresh price there is no saying which side of the market her limit is on.
  const latest = feed && feed.pair === pair ? feed.path[feed.path.length - 1] : undefined;
  if (!feed || !latest || now - latest.at > FX_RULES.freshMs) return { ok: false, reason: "NO_QUOTE" };
  // The broker's own least distance between an order and the market, and between an order and its stop or target.
  const gap = Math.max(1, feed.stopsLevel);
  if (away < gap || (target - limit) * up < gap) return { ok: false, reason: "LEVELS" };
  if (order.side === "buy" ? latest.ask - limit < gap : limit - latest.bid < gap) return { ok: false, reason: "FX_LIMIT" };
  // One trade in a pair at a time.
  if (db.prepare("SELECT id FROM fx_orders WHERE pair = ? AND status IN ('resting', 'open')").get(pair)) return { ok: false, reason: "ALREADY" };
  const id = `fx-${randomBytes(4).toString("hex")}`;
  const stopText = fromPoints(stop, digits);
  db.prepare("INSERT INTO fx_orders(id, mode, pair, side, centi_lots, risk_cents, limit_px, stop_px, target_px, status, thesis, created_at, expires_at, seen_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, 'resting', ?, ?, ?, ?)").run(id, decision.mode, pair, order.side, rules.centiLots, rules.riskCents, fromPoints(limit, digits), stopText, fromPoints(target, digits), thesis, now, now + TRADE_RULES.restMs, now);
  return { ok: true, id, mode: decision.mode, status: "resting", stop: stopText };
}

function note(db: DatabaseSync, order: FxOrderState, step: "fill" | "exit", at: number, text: string): void {
  new Ledger(db).append({ id: `fx-note-${order.id}-${step}`, atMs: at, kind: "approval", amountCents: 0, status: "confirmed", idempotencyKey: `fx:${order.id}:${step}`, note: text });
}

const dollars = (cents: number): string => `${cents < 0 ? "-" : "+"}$${(Math.abs(cents) / 100).toFixed(2)}`;

/** Her price came. The gate is asked again at that moment, and the order is filled at her limit. */
function fillFx(db: DatabaseSync, env: TradeEnv, order: FxOrderState, at: number): boolean {
  if (!evaluateFx(env, db, CLEAN, order.riskCents, at).ok) return false;
  if (Number(db.prepare("UPDATE fx_orders SET status = 'open', fill_px = limit_px, filled_at = ?, seen_at = ? WHERE id = ? AND status = 'resting'").run(at, at, order.id).changes) !== 1) return false;
  note(db, order, "fill", at, `PAPER ${order.side} ${order.pair} ${order.lots} lot at ${order.limit}. Stop ${order.stop}. Target ${order.target}. Both were set before I entered. Not advice.`);
  return true;
}

function closeFx(db: DatabaseSync, order: FxOrderState, why: "stop" | "target", exit: number, at: number): boolean {
  const { digits } = FX_PAIRS[order.pair];
  const up = order.side === "buy" ? 1 : -1;
  const result = pointsToCents(order.pair, order.centiLots, (exit - toPoints(order.fill, digits)!) * up);
  const exitText = fromPoints(exit, digits);
  if (Number(db.prepare("UPDATE fx_orders SET status = 'closed', exit_px = ?, exit_why = ?, result_cents = ?, closed_at = ?, seen_at = ? WHERE id = ? AND status = 'open'").run(exitText, why, result, at, at, order.id).changes) !== 1) return false;
  note(db, order, "exit", at, `PAPER ${order.pair} closed at ${exitText}, at its ${why}. Result ${dollars(result)}. Not advice.`);
  return true;
}

export type FxLook = { filled: number; stopped: number; taken: number; expired: number };

/**
 * One look at the market for every forex order she has out. `feedOf` gives a pair's price changes, or
 * nothing if there are none to be had, and an order with no prices is left as it is.
 *
 * Each order is played against every price change since it was last looked at, in the order they
 * happened, so a price that touched her limit, her stop or her target between two looks is not missed.
 *
 * - A buy is filled at her limit when the ask comes down to it. A sale is filled when the bid comes up to it.
 * - A trade is closed on the price she can get out at: the bid for a buy, the ask for a sale. At her stop
 *   or past it, it is closed at that price, which is worse than the stop if the market jumped. At her target
 *   or past it, it is closed at the target.
 * - An order that has waited a day for its price is cancelled.
 *
 * She is not asked about any of it. While trading is stopped nothing is done, and nothing that happened
 * meanwhile is acted on afterwards.
 */
export function fxTick(db: DatabaseSync, env: TradeEnv, feedOf: (pair: FxPair) => FxFeed | null | undefined, now: number): FxLook {
  const done: FxLook = { filled: 0, stopped: 0, taken: 0, expired: 0 };
  if (tradingStopped(env, db)) {
    db.prepare("UPDATE fx_orders SET seen_at = ? WHERE status IN ('resting', 'open') AND seen_at < ?").run(now, now);
    return done;
  }
  for (const first of activeFxOrders(db)) {
    let order = first;
    const { digits } = FX_PAIRS[order.pair];
    const [limit, stop, target] = [toPoints(order.limit, digits)!, toPoints(order.stop, digits)!, toPoints(order.target, digits)!];
    const up = order.side === "buy" ? 1 : -1;
    const feed = feedOf(order.pair);
    const from = order.seenAt;
    let seen = from;
    for (const sample of feed && feed.pair === order.pair ? feed.path : []) {
      if (sample.at <= from) continue;
      // An order's day is over: prices from then on are not for it.
      if (order.status === "resting" && sample.at >= order.expiresAt) break;
      seen = sample.at;
      if (order.status === "resting" && (order.side === "buy" ? sample.ask <= limit : sample.bid >= limit) && fillFx(db, env, order, sample.at)) {
        order = getFxOrder(db, order.id)!;
        done.filled += 1;
      }
      if (order.status !== "open") continue;
      const out = order.side === "buy" ? sample.bid : sample.ask;
      if ((out - stop) * up <= 0) {
        if (closeFx(db, order, "stop", out, sample.at)) done.stopped += 1;
        order = getFxOrder(db, order.id)!;
        break;
      }
      if ((out - target) * up >= 0) {
        if (closeFx(db, order, "target", target, sample.at)) done.taken += 1;
        order = getFxOrder(db, order.id)!;
        break;
      }
    }
    if (order.status === "resting" && now >= order.expiresAt) {
      if (Number(db.prepare("UPDATE fx_orders SET status = 'cancelled', closed_at = ?, seen_at = ? WHERE id = ? AND status = 'resting'").run(now, now, order.id).changes) === 1) done.expired += 1;
    } else if ((order.status === "resting" || order.status === "open") && seen > order.seenAt) {
      db.prepare("UPDATE fx_orders SET seen_at = ? WHERE id = ? AND status IN ('resting', 'open')").run(seen, order.id);
    }
  }
  return done;
}

/** Asks the bridge, once for each pair she has an order in, for the prices since those orders were last looked at, and takes one look. With no orders out it asks for nothing. */
export async function watchFx(db: DatabaseSync, env: TradeEnv, now: number, fetchImpl: typeof fetch = fetch): Promise<FxLook> {
  const orders = activeFxOrders(db);
  const feeds = new Map<FxPair, FxFeed>();
  for (const pair of new Set(orders.map((order) => order.pair))) {
    const since = Math.min(...orders.filter((order) => order.pair === pair).map((order) => order.seenAt));
    try {
      const feed = await fetchFxFeed(pair, since, env, now, fetchImpl);
      if (feed) feeds.set(pair, feed);
    } catch {
      // A bridge that cannot be reached is no price. The order waits for the next look.
    }
  }
  return fxTick(db, env, (pair) => feeds.get(pair), now);
}
