import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { flag, setFlag } from "../db/db";
import { currentCaps, ladderMode } from "../economy/ladder";
import { Ledger } from "../money/ledger";
import { publicMoneyClosed } from "../money/rules";
import { signerFreshness, signerHeaders, signerSignatureOk } from "../money/signerAuth";
import { TRADE_RULES, dailyLossCents, dollarsToCents, tradeCaps, tradingStopped, type TradeEnv } from "./book";

/**
 * Forex in her book. It is live. The owner's rules, 2026-11-22:
 *
 * - There is no paper trading. An order she places is a real order at his broker.
 * - AUDUSD first, at his broker, whose forex runs on MetaTrader 5.
 * - Every trade is 0.01 lot. She does not choose the size.
 * - Every trade is a limit order: it waits at a better price than the market, and is filled there or not at all.
 * - The stop is where the trade has lost three dollars. On AUDUSD at 0.01 lot that is 30 pips. It is worked
 *   out here. She does not send it and nothing moves it.
 * - The target is hers, from her own research, set before she enters. She may buy or sell.
 *
 * Her order goes to the bridge on the owner's computer (`bridge/mt5_bridge.py`), which places it through
 * the MetaTrader 5 terminal with its stop and its target in the one request. From then on the broker holds
 * all three, and they act with her engine off. The engine only asks the bridge where each order stands and
 * writes down what the broker did, in the broker's own figures.
 *
 * This file holds no login and no password. It cannot send a market order, move a stop or a target, or
 * close a trade, and neither can the bridge.
 */

/**
 * The pairs she may trade. Only a pair quoted in dollars can be here: its loss at the stop is a fixed
 * number of pips, with no second price needed to turn it into dollars. The digits and the size of one
 * lot are what her arithmetic assumes. The bridge refuses to trade a pair whose lot or digits are other,
 * and a price feed that reports anything else is not read.
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
  /** The most price changes read in one look. */
  path: 2_000,
  /** How long the bridge is waited on. It waits twenty seconds for the terminal itself. */
  waitMs: 25_000,
  /** An order the bridge was asked to place, and has no record of after this long, never reached the broker. */
  lostMs: 120_000,
} as const;

/** The size of one forex trade and what it loses at its stop: the owner's 0.01 lot and three dollars, or the figures he has set. The bridge holds the same two figures and refuses an order that is not his size or risks more. */
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

/** Her bridge is set up: an address that may be called, and the secret the two share. With that, forex is live. */
export function fxBridgeSet(env: TradeEnv): boolean {
  return fxBridgeUrl(env) !== null && (env.LUMEN_FX_BRIDGE_SECRET ?? "").length >= 32;
}

type Answer = { status: number; json: Record<string, unknown> };

/**
 * One question to the bridge. It is signed with the secret the two share, and an answer is believed only
 * if it is signed with it too and carries the question's own nonce, so nothing but her own bridge is ever
 * believed and an old answer cannot be played back. A bridge that cannot be reached, or anything that is
 * not such an answer, is silence.
 */
async function askBridge(env: TradeEnv, ask: Record<string, unknown>, now: number, fetchImpl: typeof fetch, waitMs: number = FX_RULES.waitMs): Promise<Answer | null> {
  const url = fxBridgeUrl(env);
  const secret = env.LUMEN_FX_BRIDGE_SECRET ?? "";
  if (!url || secret.length < 32) return null;
  const fresh = signerFreshness(now);
  const body = JSON.stringify({ ...ask, ...fresh });
  const headers = signerHeaders(secret, body);
  if (!headers) return null;
  try {
    const response = await fetchImpl(url, { method: "POST", headers, body, signal: AbortSignal.timeout(waitMs) });
    const text = await response.text();
    if (text.length > 200_000 || !signerSignatureOk(secret, text, response.headers.get("x-lumen-signature"))) return null;
    const json = JSON.parse(text) as unknown;
    if (!json || typeof json !== "object" || (json as { nonce?: unknown }).nonce !== fresh.nonce) return null;
    return { status: response.status, json: json as Record<string, unknown> };
  } catch {
    return null;
  }
}

/** One price change the bridge saw: when, and the bid and the ask in points. */
export type FxSample = { at: number; bid: number; ask: number };
/** The broker's prices for a pair: the kind of account the terminal is logged in to, how near the market the broker lets an order sit, and every price change since a time, oldest first. */
export type FxFeed = { pair: FxPair; account: "demo" | "real" | "contest"; stopsLevel: number; path: FxSample[] };

/** Reads the bridge's prices. Anything out of shape, a pair whose lot or digits are not what her arithmetic assumes, or a price from the future, and none of it is used. */
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

/** The broker's prices for a pair since a time, for her research. No price, if the bridge has none to give or cannot be reached. */
export async function fetchFxFeed(pair: FxPair, sinceMs: number, env: TradeEnv, now: number, fetchImpl: typeof fetch = fetch): Promise<FxFeed | null> {
  const answer = await askBridge(env, { instruction: "quote", pair, sinceMs: Math.max(0, Math.floor(sinceMs)) }, now, fetchImpl, 4_000);
  return answer && answer.status === 200 ? parseFxFeed(answer.json, pair, now) : null;
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

export type FxOrderState = {
  id: string;
  /** `live` is real money. `demo` is a broker's practice account, if that is what the terminal is logged in to. The broker says which, not the engine. */
  mode: "live" | "demo";
  pair: FxPair;
  side: FxSide;
  lots: string;
  centiLots: number;
  riskCents: number;
  limit: string;
  stop: string;
  target: string;
  /** `sending` is an order the bridge has been asked to place, with no clear word back yet. */
  status: "sending" | "resting" | "open" | "closed" | "cancelled";
  /** The broker's own number for it. */
  ticket: string | null;
  fill: string | null;
  exit: string | null;
  /** `other` is a close that was neither: by the owner's hand in the terminal, or by the broker. */
  exitWhy: "stop" | "target" | "other" | null;
  /** The broker's own figure, with its commission and swap taken off. */
  resultCents: number | null;
  /** Why it was not placed, or what went wrong with it. */
  note: string | null;
  thesis: string;
  createdAt: number;
  expiresAt: number;
  /** When the bridge last said where it stands. */
  seenAt: number;
  filledAt: number | null;
  closedAt: number | null;
};
type FxRow = { id: string; mode: FxOrderState["mode"]; pair: FxPair; side: FxSide; centi_lots: number; risk_cents: number; limit_px: string; stop_px: string; target_px: string; status: FxOrderState["status"]; ticket: string | null; fill_px: string | null; exit_px: string | null; exit_why: FxOrderState["exitWhy"]; result_cents: number | null; note: string | null; thesis: string; created_at: number; expires_at: number; seen_at: number; filled_at: number | null; closed_at: number | null };
const lotsText = (centi: number): string => (centi / 100).toFixed(2);
const stateOf = (row: FxRow): FxOrderState => ({ id: row.id, mode: row.mode, pair: row.pair, side: row.side, lots: lotsText(Number(row.centi_lots)), centiLots: Number(row.centi_lots), riskCents: Number(row.risk_cents), limit: row.limit_px, stop: row.stop_px, target: row.target_px, status: row.status, ticket: row.ticket ?? null, fill: row.fill_px, exit: row.exit_px, exitWhy: row.exit_why, resultCents: row.result_cents == null ? null : Number(row.result_cents), note: row.note ?? null, thesis: row.thesis, createdAt: Number(row.created_at), expiresAt: Number(row.expires_at), seenAt: Number(row.seen_at), filledAt: row.filled_at == null ? null : Number(row.filled_at), closedAt: row.closed_at == null ? null : Number(row.closed_at) });
const ACTIVE = "('sending', 'resting', 'open')";

/** Her forex orders that are on their way to the broker, waiting there for their price, or in a trade, oldest first. */
export function activeFxOrders(db: DatabaseSync): FxOrderState[] {
  return (db.prepare(`SELECT * FROM fx_orders WHERE mode IN ('live', 'demo') AND status IN ${ACTIVE} ORDER BY created_at, id`).all() as FxRow[]).map(stateOf);
}

/** Her latest forex orders, newest first, for the floor. A row left over from when there was paper trading is not one of them. */
export function recentFxOrders(db: DatabaseSync, limit = 8): FxOrderState[] {
  return (db.prepare("SELECT * FROM fx_orders WHERE mode IN ('live', 'demo') ORDER BY created_at DESC, id DESC LIMIT ?").all(Math.max(1, Math.min(50, Math.floor(limit)))) as FxRow[]).map(stateOf);
}

/** What her closed forex trades on the real account come to, in cents, in the broker's own figures. */
export function fxResultCents(db: DatabaseSync): number {
  const row = db.prepare("SELECT COALESCE(SUM(result_cents), 0) AS cents FROM fx_orders WHERE mode = 'live' AND status = 'closed' AND result_cents IS NOT NULL").get() as { cents: number };
  return Number(row.cents);
}

export function getFxOrder(db: DatabaseSync, id: string): FxOrderState | null {
  const row = db.prepare("SELECT * FROM fx_orders WHERE id = ?").get(id) as FxRow | undefined;
  return row ? stateOf(row) : null;
}

type Influence = Pick<FxOrder, "influencedByVisitor" | "influencedByWeb" | "influencedByTelegram">;
/** A broker password or a signing key does not belong in this app. If one of these is set, forex stays shut. */
const KEYS_NOT_HERS = ["LUMEN_MT5_PASSWORD", "MT5_PASSWORD", "LUMEN_TRADING_PRIVATE_KEY", "SOLANA_PRIVATE_KEY"];

/**
 * Asked before a forex order is sent. Whether her money covers the trade is not asked here: the terminal
 * checks that against the account itself before anything is sent, and says no if it does not.
 */
export function evaluateFx(env: TradeEnv, db: DatabaseSync, influence: Influence, riskCents: number, now: number): { ok: true } | { ok: false; reason: string } {
  if (KEYS_NOT_HERS.some((name) => env[name])) return { ok: false, reason: "KEY_IN_APP" };
  if (influence.influencedByVisitor || influence.influencedByWeb || influence.influencedByTelegram) return { ok: false, reason: "INFLUENCE" };
  if (tradingStopped(env, db)) return { ok: false, reason: "KILL_SWITCH" };
  if (flag(db, "trading_unknown") === "1") return { ok: false, reason: "UNKNOWN" };
  // A daily loss limit is the owner's to set. With none set there is none. If he sets one, it is one limit over coins and forex.
  const limit = tradeCaps(env).maxDailyLossCents;
  if (limit != null && dailyLossCents(db, "live", now) + riskCents > limit) return { ok: false, reason: "DAILY_LOSS" };
  if (publicMoneyClosed(env)) return { ok: false, reason: "PUBLIC_MODE" };
  // A tripped brake stops her trading until the owner clears it. If he has set the ladder to "earned", it says whether she trades yet and how much.
  if (flag(db, "econ_brake") === "1") return { ok: false, reason: "BRAKE" };
  if (ladderMode(db) === "earned") {
    const caps = currentCaps(db, now);
    if (caps.trading !== "live") return { ok: false, reason: "LADDER" };
    if (riskCents > caps.tradeCents) return { ok: false, reason: "LADDER_CAP" };
  }
  return { ok: true };
}

export type FxOrderResult = { ok: true; id: string; mode: "live" | "demo"; status: "resting" | "open"; /** Where the book put her stop. */ stop: string; ticket: string | null } | { ok: false; reason: string; /** Set when a row was written for it. */ id?: string };

function note(db: DatabaseSync, order: FxOrderState, step: "fill" | "exit", at: number, text: string): void {
  new Ledger(db).append({ id: `fx-note-${order.id}-${step}`, atMs: at, kind: "approval", amountCents: 0, status: "confirmed", idempotencyKey: `fx:${order.id}:${step}`, note: text });
}

const dollars = (cents: number): string => `${cents < 0 ? "-" : "+"}$${(Math.abs(cents) / 100).toFixed(2)}`;
const whole = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value);

/** Something is not as it should be with a real order. Her trading waits for the owner, and the order says why. */
function alarm(db: DatabaseSync, id: string, why: string): void {
  setFlag(db, "trading_unknown", "1");
  db.prepare("UPDATE fx_orders SET note = ? WHERE id = ?").run(why.slice(0, 160), id);
}

type Stand = FxOrderState["status"] | "none" | "unknown";

/**
 * Writes down where the bridge says one of her orders stands at the broker. Nothing is worked out here:
 * the fill, the exit and the result are the broker's own. An order moves forward only, and a step is
 * written to the ledger once.
 */
function adopt(db: DatabaseSync, order: FxOrderState, json: Record<string, unknown>, now: number): Stand {
  if (json.id !== order.id) return "unknown";
  const { digits } = FX_PAIRS[order.pair];
  const mode = json.account === "real" ? "live" : json.account === "demo" || json.account === "contest" ? "demo" : order.mode;
  const ticket = typeof json.ticket === "string" && /^\d{1,24}$/.test(json.ticket) ? json.ticket : order.ticket;
  // If the bridge says what the broker holds, it has to be what she sent.
  const sent: [string, unknown][] = [["side", order.side], ["centiLots", order.centiLots], ["limit", toPoints(order.limit, digits)], ["stop", toPoints(order.stop, digits)], ["target", toPoints(order.target, digits)]];
  const differs = sent.filter(([name, value]) => json[name] !== undefined && json[name] !== value).map(([name]) => name);
  if (differs.length) alarm(db, order.id, `The broker holds another ${differs.join(", ")} than she sent.`);
  db.prepare("UPDATE fx_orders SET mode = ?, ticket = ?, seen_at = ? WHERE id = ?").run(mode, ticket, now, order.id);
  const label = mode === "live" ? "LIVE" : "DEMO";
  const price = (value: unknown): string | null => (whole(value) && value > 0 ? fromPoints(value, digits) : null);
  const stand = json.status;

  if (stand === "resting") {
    db.prepare("UPDATE fx_orders SET status = 'resting' WHERE id = ? AND status = 'sending'").run(order.id);
    return "resting";
  }
  if (stand === "open" || stand === "closed") {
    const fill = price(json.fill) ?? order.fill ?? order.limit;
    if (Number(db.prepare("UPDATE fx_orders SET status = 'open', fill_px = ?, filled_at = ? WHERE id = ? AND status IN ('sending', 'resting')").run(fill, now, order.id).changes) === 1) {
      note(db, order, "fill", now, `${label} ${order.side} ${order.pair} ${order.lots} lot at ${fill}. Stop ${order.stop}. Target ${order.target}. Both were set before I entered, and the broker holds them. Not advice.`);
    }
    if (stand === "open") return "open";
    const exit = price(json.exit);
    const why = json.exitWhy === "stop" || json.exitWhy === "target" ? json.exitWhy : "other";
    if (!exit || !whole(json.resultCents)) return "open";
    if (Number(db.prepare("UPDATE fx_orders SET status = 'closed', exit_px = ?, exit_why = ?, result_cents = ?, closed_at = ? WHERE id = ? AND status = 'open'").run(exit, why, json.resultCents, now, order.id).changes) === 1) {
      const how = why === "other" ? "not at its stop or its target" : `at its ${why}`;
      note(db, order, "exit", now, `${label} ${order.pair} closed at ${exit}, ${how}. Result ${dollars(json.resultCents)}, the broker's figure. Not advice.`);
    }
    return "closed";
  }
  if (stand === "cancelled" || stand === "refused") {
    const why = stand === "refused" && typeof json.reason === "string" ? json.reason.slice(0, 60) : null;
    db.prepare(`UPDATE fx_orders SET status = 'cancelled', closed_at = ?, note = COALESCE(?, note) WHERE id = ? AND status IN ('sending', 'resting')`).run(now, why, order.id);
    return "cancelled";
  }
  if (stand === "none") {
    // The bridge has no record of it and it is not at the broker.
    if (order.status === "sending") {
      if (now - order.createdAt < FX_RULES.lostMs) return "unknown";
      db.prepare("UPDATE fx_orders SET status = 'cancelled', closed_at = ?, note = ? WHERE id = ? AND status = 'sending'").run(now, "It never reached the broker.", order.id);
      return "cancelled";
    }
    alarm(db, order.id, "The bridge has lost track of this order. Look at the terminal.");
  }
  return "unknown";
}

/**
 * She places a forex trade. It is 0.01 lot, at her limit, with her target, and with a stop the book puts
 * where the trade has lost three dollars, or it is not placed. It is a real order.
 *
 * The order is written down before the bridge is asked, so it is never sent twice. The bridge has the
 * terminal check it, has the terminal's own sum agree that the stop loses what the rule says, sends it,
 * and reads it back from the broker. If the bridge gives no clear word, the order stays written as on its
 * way, no other is placed in the pair, and `watchFx` finds out what became of it.
 */
export async function placeFxOrder(db: DatabaseSync, env: TradeEnv, order: FxOrder, now: number, fetchImpl: typeof fetch = fetch): Promise<FxOrderResult> {
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
  if (!fxBridgeSet(env)) return { ok: false, reason: "NO_BRIDGE" };
  // One trade in a pair at a time, and an order still on its way counts.
  if (db.prepare(`SELECT id FROM fx_orders WHERE pair = ? AND mode IN ('live', 'demo') AND status IN ${ACTIVE}`).get(pair)) return { ok: false, reason: "ALREADY" };
  const id = `fx-${randomBytes(4).toString("hex")}`;
  const stopText = fromPoints(stop, digits);
  db.prepare("INSERT INTO fx_orders(id, mode, pair, side, centi_lots, risk_cents, limit_px, stop_px, target_px, status, thesis, created_at, expires_at, seen_at) VALUES(?, 'live', ?, ?, ?, ?, ?, ?, ?, 'sending', ?, ?, ?, ?)").run(id, pair, order.side, rules.centiLots, rules.riskCents, fromPoints(limit, digits), stopText, fromPoints(target, digits), thesis, now, now + TRADE_RULES.restMs, now);
  const answer = await askBridge(env, { instruction: "place", id, pair, side: order.side, centiLots: rules.centiLots, limit, stop, target, lossCents: pointsToCents(pair, rules.centiLots, away) }, now, fetchImpl);
  const written = getFxOrder(db, id)!;
  if (!answer || answer.json.reason === "UNKNOWN") return { ok: false, reason: "UNKNOWN", id };
  if (answer.json.ok !== true) {
    const reason = typeof answer.json.reason === "string" && /^[A-Z0-9_]{2,40}$/.test(answer.json.reason) ? answer.json.reason : "REFUSED";
    if (reason === "READBACK_STUCK") {
      // The broker holds an order that is not what she sent, and the bridge could not pull it. Nothing is cancelled here: it is still there.
      alarm(db, id, "The broker holds this order with another price, stop or target than she sent, and it could not be pulled. Look at the terminal.");
      return { ok: false, reason, id };
    }
    const says = typeof answer.json.brokerSays === "string" ? ` ${answer.json.brokerSays.replace(/[^\x20-\x7e]/g, "").slice(0, 80)}` : "";
    db.prepare("UPDATE fx_orders SET status = 'cancelled', closed_at = ?, note = ? WHERE id = ? AND status = 'sending'").run(now, `${reason}${says}`.trim(), id);
    return { ok: false, reason, id };
  }
  const stand = adopt(db, written, answer.json, now);
  const after = getFxOrder(db, id)!;
  if (stand === "resting" || stand === "open") return { ok: true, id, mode: after.mode, status: stand, stop: stopText, ticket: after.ticket };
  return { ok: false, reason: stand === "cancelled" ? "CANCELLED" : stand === "closed" ? "CLOSED" : "UNKNOWN", id };
}

export type FxLook = { filled: number; stopped: number; taken: number; /** Closed some other way: by the owner's hand, or by the broker. */ closed: number; cancelled: number };

/**
 * One look at every forex order she has out. The broker holds each one with its stop and its target, so
 * nothing is decided here: the bridge is asked where each stands and that is written down.
 *
 * An order that has waited a day for its price is pulled from the broker. While trading is stopped, every
 * order still waiting is pulled. A trade that is already open is left as it is: it has its stop and its
 * target at the broker, and she does not close a trade by choice.
 *
 * With no orders out the bridge is not asked anything. A bridge that does not answer changes nothing.
 */
export async function watchFx(db: DatabaseSync, env: TradeEnv, now: number, fetchImpl: typeof fetch = fetch): Promise<FxLook> {
  const done: FxLook = { filled: 0, stopped: 0, taken: 0, closed: 0, cancelled: 0 };
  const stopped = tradingStopped(env, db);
  for (const order of activeFxOrders(db)) {
    const pull = order.status === "resting" && (stopped || now >= order.expiresAt);
    const answer = await askBridge(env, { instruction: pull ? "cancel" : "state", id: order.id }, now, fetchImpl);
    if (!answer || answer.json.ok !== true) continue;
    const stand = adopt(db, order, answer.json, now);
    const after = getFxOrder(db, order.id)!;
    if (after.status === order.status) continue;
    if (after.status === "cancelled") done.cancelled += 1;
    if ((after.status === "open" || after.status === "closed") && order.status !== "open") done.filled += 1;
    if (stand === "closed" && after.status === "closed") {
      if (after.exitWhy === "stop") done.stopped += 1;
      else if (after.exitWhy === "target") done.taken += 1;
      else done.closed += 1;
    }
  }
  return done;
}
