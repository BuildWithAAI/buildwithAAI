import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { flag, openDatabase, setFlag } from "../src/db/db";
import { setLadderMode } from "../src/economy/ladder";
import { TRADE_RULES, dailyLossCents } from "../src/trading/book";
import { FX_FRAMES, FX_PAIRS, FX_RULES, activeFxOrders, evaluateFx, fetchFxBars, fetchFxFeed, fxBridgeSet, fxBridgeUrl, fxResultCents, fxRules, getFxOrder, parseFxBars, parseFxFeed, placeFxOrder, pointsToCents, recentFxOrders, stopPoints, watchFx, type FxOrder } from "../src/trading/forex";
import { grantLiveTrading } from "./helpers/ladder";

// A Monday, 03:00 UTC. Prices on the wire are in points: 65000 is 0.65000, and ten points are a pip.
const now = Date.UTC(2026, 10, 23, 3);
const MINUTE = 60_000;
const secret = "bridge-".concat("s".repeat(40));
const live = { LUMEN_FX_BRIDGE_URL: "http://127.0.0.1:8765", LUMEN_FX_BRIDGE_SECRET: secret };
const hmac = (key: string, text: string) => createHmac("sha256", key).update(text).digest("hex");
const order = (over: Partial<FxOrder> = {}): FxOrder => ({ pair: "AUDUSD", side: "buy", limit: "0.65000", target: "0.65600", thesis: "the price has held this level three times this week", influencedByVisitor: false, influencedByWeb: false, influencedByTelegram: false, ...over });
const sale = (over: Partial<FxOrder> = {}): FxOrder => order({ side: "sell", limit: "0.65500", target: "0.65000", ...over });
const idOf = (result: unknown) => (result as { id: string }).id;
const NOTHING = { filled: 0, stopped: 0, taken: 0, closed: 0, cancelled: 0 };
const noteOf = (db: ReturnType<typeof openDatabase>, id: string, step: "fill" | "exit") => (db.prepare("SELECT note FROM ledger_entries WHERE idempotency_key = ?").get(`fx:${id}:${step}`) as { note: string } | undefined)?.note;

type Ask = Record<string, unknown> & { instruction: string; id: string; nonce: string };
type Held = { status: string; ticket: string; account: string; ask: Ask; fill?: number; exit?: number; exitWhy?: string; resultCents?: number; reason?: string };

/**
 * A bridge and a broker for these tests, in a few lines. It keeps what it was asked to place and answers
 * the way `bridge/mt5_bridge.py` does, signed with the shared secret. The real bridge is run for real in
 * `fxBridge.test.ts`. Nothing here is a price: these tests are about what the engine sends and writes down.
 */
function broker(account: "real" | "demo" = "real") {
  const held = new Map<string, Held>();
  const asked: Ask[] = [];
  const say: { down: boolean; deaf: boolean; refuse: Record<string, unknown> | null; forge: ((answer: Record<string, unknown>) => { body: unknown; signature?: string | null }) | null } = { down: false, deaf: false, refuse: null, forge: null };
  let ticket = 500_000;
  const stand = (id: string): Record<string, unknown> => {
    const order = held.get(id);
    if (!order) return { ok: true, id, status: "none" };
    const { ask, ...rest } = order;
    return { ok: true, id, side: ask.side, centiLots: ask.centiLots, limit: ask.limit, stop: ask.stop, target: ask.target, ...rest };
  };
  const fetchImpl = (async (_url: string, init: { body: string; headers: Record<string, string> }) => {
    const ask = JSON.parse(init.body) as Ask;
    asked.push(ask);
    if (say.down) throw new Error("ECONNREFUSED");
    // The bridge lets in only what is signed with the secret.
    expect(init.headers["x-lumen-signature"]).toBe(hmac(secret, init.body));
    let answer: Record<string, unknown>;
    if (ask.instruction === "place") {
      if (say.refuse) answer = { ok: false, id: ask.id, ...say.refuse };
      else {
        // An id it has seen is never placed again.
        if (!held.has(ask.id)) held.set(ask.id, { status: "resting", ticket: String((ticket += 1)), account, ask });
        answer = stand(ask.id);
      }
      // The broker took it, and the answer never got back.
      if (say.deaf) throw new Error("ETIMEDOUT");
    } else if (ask.instruction === "cancel") {
      const order = held.get(ask.id);
      if (order && order.status === "resting") order.status = "cancelled";
      answer = stand(ask.id);
    } else if (ask.instruction === "state") answer = stand(ask.id);
    else answer = { ok: false, reason: "INSTRUCTION" };
    answer = { ...answer, nonce: ask.nonce };
    const forged = say.forge?.(answer);
    const text = JSON.stringify(forged ? forged.body : answer);
    const signature = forged && forged.signature !== undefined ? forged.signature : hmac(secret, text);
    return new Response(text, { status: answer.ok ? 200 : 409, headers: signature ? { "x-lumen-signature": signature } : {} });
  }) as unknown as typeof fetch;
  return { held, asked, say, fetchImpl, of: (id: string) => held.get(id)!, sent: (instruction: string) => asked.filter((ask) => ask.instruction === instruction) };
}

describe("forex: live, under the owner's rules", () => {
  it("places a real order: 0.01 lot, a limit, a stop where three dollars is lost, and her own target", async () => {
    expect(FX_PAIRS.AUDUSD).toEqual({ digits: 5, contract: 100_000 });
    expect(fxRules({})).toEqual({ centiLots: 1, riskCents: 300 });
    expect(stopPoints("AUDUSD", fxRules({}))).toBe(300);
    // On 0.01 lot a pip is ten cents, so thirty of them are the three dollars.
    expect([pointsToCents("AUDUSD", 1, 10), pointsToCents("AUDUSD", 1, 300)]).toEqual([10, 300]);

    const db = openDatabase();
    const desk = broker();
    const placed = await placeFxOrder(db, live, order({ limit: "0.65" }), now, desk.fetchImpl);
    expect(placed).toEqual({ ok: true, id: expect.stringMatching(/^fx-[0-9a-f]{8}$/), mode: "live", status: "resting", stop: "0.64700", ticket: "500001" });
    const id = idOf(placed);
    // What went to the bridge, whole. Her stop is the book's, 30 pips under her limit, and the loss there is the rule's three dollars.
    expect(desk.asked).toEqual([{ instruction: "place", id, pair: "AUDUSD", side: "buy", centiLots: 1, limit: 65_000, stop: 64_700, target: 65_600, lossCents: 300, nonce: expect.stringMatching(/^[0-9a-f]{32}$/), issuedAtMs: now }]);
    expect(getFxOrder(db, id)).toMatchObject({ mode: "live", status: "resting", ticket: "500001", pair: "AUDUSD", side: "buy", lots: "0.01", riskCents: 300, limit: "0.65000", stop: "0.64700", target: "0.65600", fill: null, note: null, expiresAt: now + TRADE_RULES.restMs });

    // A sale has its stop the same distance over her entry.
    const other = broker();
    expect(await placeFxOrder(openDatabase(), live, sale(), now, other.fetchImpl)).toMatchObject({ ok: true, mode: "live", stop: "0.65800" });
    expect(other.asked[0]).toMatchObject({ side: "sell", limit: 65_500, stop: 65_800, target: 65_000, lossCents: 300 });
  });

  it("never treats a row marked paper as an order of hers", async () => {
    const db = openDatabase();
    const desk = broker();
    // However such a row came to be in her books, the broker is never asked about it and it stands in nothing's way.
    db.prepare("INSERT INTO fx_orders(id, mode, pair, side, centi_lots, risk_cents, limit_px, stop_px, target_px, status, thesis, created_at, expires_at, seen_at) VALUES('fx-0000aaaa', 'paper', 'AUDUSD', 'buy', 1, 300, '0.65000', '0.64700', '0.65600', 'resting', 'left over', ?, ?, ?)").run(now, now + TRADE_RULES.restMs, now);
    db.prepare("INSERT INTO fx_orders(id, mode, pair, side, centi_lots, risk_cents, limit_px, stop_px, target_px, status, fill_px, exit_px, exit_why, result_cents, thesis, created_at, expires_at, seen_at, closed_at) VALUES('fx-0000bbbb', 'paper', 'AUDUSD', 'buy', 1, 300, '0.65000', '0.64700', '0.65600', 'closed', '0.65000', '0.64700', 'stop', -300, 'left over', ?, ?, ?, ?)").run(now, now + TRADE_RULES.restMs, now, now);
    expect(activeFxOrders(db)).toEqual([]);
    expect(recentFxOrders(db)).toEqual([]);
    expect(fxResultCents(db)).toBe(0);
    expect(await watchFx(db, live, now + MINUTE, desk.fetchImpl)).toEqual(NOTHING);
    expect(desk.asked).toEqual([]);
    // Its three-dollar loss is not a loss of hers today, so a five-dollar daily limit still has room for a real trade.
    const placed = await placeFxOrder(db, { ...live, LUMEN_TRADE_DAILY_LOSS_USD: "5" }, order(), now, desk.fetchImpl);
    expect(placed).toMatchObject({ ok: true, mode: "live", status: "resting" });
    expect(activeFxOrders(db).map((item) => [item.id, item.mode])).toEqual([[idOf(placed), "live"]]);
    expect(recentFxOrders(db).map((item) => item.id)).toEqual([idOf(placed)]);
    expect((db.prepare("SELECT status FROM fx_orders WHERE id = 'fx-0000aaaa'").get() as { status: string }).status).toBe("resting");
  });

  it("follows the figures the owner sets, and never loses more at the stop than he said", async () => {
    expect(fxRules({ LUMEN_FX_LOTS: "0.02", LUMEN_FX_RISK_USD: "5" })).toEqual({ centiLots: 2, riskCents: 500 });
    expect(fxRules({ LUMEN_FX_LOTS: "lots", LUMEN_FX_RISK_USD: "-3" })).toEqual({ centiLots: 1, riskCents: 300 });
    expect(fxRules({ LUMEN_FX_LOTS: "0", LUMEN_FX_RISK_USD: "0" })).toEqual({ centiLots: 1, riskCents: 300 });
    // Twice the size, half the distance. A bigger loss allowed, a wider stop.
    expect(stopPoints("AUDUSD", fxRules({ LUMEN_FX_LOTS: "0.02" }))).toBe(150);
    expect(stopPoints("AUDUSD", fxRules({ LUMEN_FX_RISK_USD: "5" }))).toBe(500);
    // 0.07 lot does not divide three dollars evenly. The stop is put nearer, so the loss is $2.94 and not $3.01.
    const odd = fxRules({ LUMEN_FX_LOTS: "0.07" });
    expect(stopPoints("AUDUSD", odd)).toBe(42);
    expect(pointsToCents("AUDUSD", odd.centiLots, stopPoints("AUDUSD", odd))).toBe(294);
    const desk = broker();
    await placeFxOrder(openDatabase(), { ...live, LUMEN_FX_LOTS: "0.07" }, order(), now, desk.fetchImpl);
    expect(desk.asked[0]).toMatchObject({ centiLots: 7, stop: 64_958, lossCents: 294 });
    // A size so large that three dollars is less than one point away cannot be traded under the rule.
    expect(await placeFxOrder(openDatabase(), { ...live, LUMEN_FX_LOTS: "500" }, order(), now, desk.fetchImpl)).toEqual({ ok: false, reason: "FX_RULES" });
  });

  it("refuses an order that is not a proper one, and the bridge is asked nothing", async () => {
    const db = openDatabase();
    const desk = broker();
    const place = (over: Partial<FxOrder>, env: Record<string, string> = {}) => placeFxOrder(db, { ...live, ...env }, order(over), now, desk.fetchImpl);
    for (const pair of ["EURUSD", "USDJPY", "audusd", "", "constructor"]) expect(await place({ pair })).toEqual({ ok: false, reason: "FX_PAIR" });
    expect(await place({ side: "long" as "buy" })).toEqual({ ok: false, reason: "FX_SIDE" });
    // A target has to be on the side she profits on, and a price has to be a plain price.
    for (const bad of [{ target: "0.65000" }, { target: "0.64000" }, { limit: "1e3" }, { limit: "-0.65" }, { limit: "" }, { target: "soon" }, { limit: "0.650001" }, { limit: "0" }]) expect(await place(bad)).toEqual({ ok: false, reason: "LEVELS" });
    expect(await placeFxOrder(db, live, sale({ target: "0.65500" }), now, desk.fetchImpl)).toEqual({ ok: false, reason: "LEVELS" });
    expect(await placeFxOrder(db, live, sale({ target: "0.66000" }), now, desk.fetchImpl)).toEqual({ ok: false, reason: "LEVELS" });
    // A stop under zero is no stop.
    expect(await place({ limit: "0.00200", target: "0.00300" })).toEqual({ ok: false, reason: "LEVELS" });
    expect(await place({ thesis: "vibes" })).toEqual({ ok: false, reason: "NO_THESIS" });
    for (const flagged of [{ influencedByVisitor: true }, { influencedByWeb: true }, { influencedByTelegram: true }]) expect(await place(flagged)).toEqual({ ok: false, reason: "INFLUENCE" });
    expect(await place({}, { LUMEN_KILL_SWITCH: "true" })).toEqual({ ok: false, reason: "KILL_SWITCH" });
    // A broker password has no business in this app. If one is in its settings, forex stays shut.
    expect(await place({}, { MT5_PASSWORD: "set" })).toEqual({ ok: false, reason: "KEY_IN_APP" });
    expect(await place({}, { LUMEN_MT5_PASSWORD: "set" })).toEqual({ ok: false, reason: "KEY_IN_APP" });
    expect(desk.asked).toEqual([]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM fx_orders").get()).toEqual({ n: 0 });
  });

  it("does not trade past the owner's own gates", async () => {
    const desk = broker();
    const place = (db: ReturnType<typeof openDatabase>, env: Record<string, string | undefined>, at = now, over: Partial<FxOrder> = {}) => placeFxOrder(db, env, order(over), at, desk.fetchImpl);
    // With no bridge set up there is nowhere to send an order, and nothing else is done with it.
    expect(fxBridgeSet({})).toBe(false);
    expect(await place(openDatabase(), {})).toEqual({ ok: false, reason: "NO_BRIDGE" });
    expect(await place(openDatabase(), { ...live, LUMEN_FX_BRIDGE_SECRET: "short" })).toEqual({ ok: false, reason: "NO_BRIDGE" });
    expect(await place(openDatabase(), { ...live, LUMEN_FX_BRIDGE_URL: "http://example.com:8765" })).toEqual({ ok: false, reason: "NO_BRIDGE" });
    // The public site with money still shut.
    expect(await place(openDatabase(), { ...live, LUMEN_PUBLIC_MODE: "true" })).toEqual({ ok: false, reason: "PUBLIC_MODE" });
    // An unclear word about a real order, or a tripped brake, stops her trading until the owner clears it.
    const paused = openDatabase();
    setFlag(paused, "trading_unknown", "1");
    expect(await place(paused, live)).toEqual({ ok: false, reason: "UNKNOWN" });
    const braked = openDatabase();
    setFlag(braked, "econ_brake", "1");
    expect(await place(braked, live)).toEqual({ ok: false, reason: "BRAKE" });
    // If he has set the ladder to "earned", she trades once he has approved the step that opens trading, and no more than it allows.
    const ladder = openDatabase();
    setLadderMode(ladder, "earned");
    expect(await place(ladder, live)).toEqual({ ok: false, reason: "LADDER" });
    expect(await place(grantLiveTrading(openDatabase()), { ...live, LUMEN_FX_RISK_USD: "6000" }, now, { limit: "9.00000", target: "9.10000" })).toEqual({ ok: false, reason: "LADDER_CAP" });
    expect(desk.asked).toEqual([]);
    expect(await place(grantLiveTrading(openDatabase()), live)).toMatchObject({ ok: true, mode: "live" });
    expect(await place(openDatabase(), { ...live, LUMEN_PUBLIC_MODE: "true", LUMEN_MONEY_LIVE: "true" })).toMatchObject({ ok: true, mode: "live" });
    // The old live switch decides nothing. There is no paper, so there is nothing for it to switch from.
    expect(evaluateFx({ LUMEN_TRADING_LIVE: "false" }, openDatabase(), order(), 300, now)).toEqual({ ok: true });
  });

  it("says why when the bridge or the broker will not take an order, and places nothing", async () => {
    const db = openDatabase();
    const desk = broker();
    // Her limit was at the market. A limit order has to wait at a better price, and the bridge checks that against the live price.
    desk.say.refuse = { reason: "FX_LIMIT", bid: 65_000, ask: 65_008 };
    const first = await placeFxOrder(db, live, order(), now, desk.fetchImpl);
    expect(first).toEqual({ ok: false, reason: "FX_LIMIT", id: expect.any(String) });
    expect(getFxOrder(db, idOf(first))).toMatchObject({ status: "cancelled", note: "FX_LIMIT", ticket: null, closedAt: now });
    desk.say.refuse = { reason: "BROKER_10016", brokerSays: "Invalid stops" };
    const second = await placeFxOrder(db, live, order(), now + 1, desk.fetchImpl);
    expect(getFxOrder(db, idOf(second))).toMatchObject({ status: "cancelled", note: "BROKER_10016 Invalid stops" });
    desk.say.refuse = { reason: "the broker said <b>no</b>" };
    expect(await placeFxOrder(db, live, order(), now + 2, desk.fetchImpl)).toMatchObject({ ok: false, reason: "REFUSED" });
    expect(desk.held.size).toBe(0);
    // A refusal is not an order. She may place another.
    desk.say.refuse = null;
    expect(await placeFxOrder(db, live, order(), now + 3, desk.fetchImpl)).toMatchObject({ ok: true, status: "resting" });
    expect(await placeFxOrder(db, live, order(), now + 4, desk.fetchImpl)).toEqual({ ok: false, reason: "ALREADY" });
  });
});

describe("forex: an order is never sent twice and never forgotten", () => {
  it("keeps an order written as on its way when the bridge goes quiet, and places no other in the pair", async () => {
    const db = openDatabase();
    const desk = broker();
    desk.say.down = true;
    const placed = await placeFxOrder(db, live, order(), now, desk.fetchImpl);
    expect(placed).toEqual({ ok: false, reason: "UNKNOWN", id: expect.any(String) });
    const id = idOf(placed);
    expect(getFxOrder(db, id)).toMatchObject({ status: "sending", ticket: null });
    expect(await placeFxOrder(db, live, order(), now + 1_000, desk.fetchImpl)).toEqual({ ok: false, reason: "ALREADY" });
    // With the bridge still down a look changes nothing.
    expect(await watchFx(db, live, now + MINUTE, desk.fetchImpl)).toEqual(NOTHING);
    expect(getFxOrder(db, id)).toMatchObject({ status: "sending" });
    // The bridge is back and has no record of it. It is given two minutes before it is taken as never having arrived.
    desk.say.down = false;
    expect(await watchFx(db, live, now + FX_RULES.lostMs - 1, desk.fetchImpl)).toEqual(NOTHING);
    expect(await watchFx(db, live, now + FX_RULES.lostMs, desk.fetchImpl)).toEqual({ ...NOTHING, cancelled: 1 });
    expect(getFxOrder(db, id)).toMatchObject({ status: "cancelled", note: "It never reached the broker." });
    // In all of that the bridge was asked to place it exactly once.
    expect(desk.sent("place")).toHaveLength(1);
    expect(await placeFxOrder(db, live, order(), now + 3 * MINUTE, desk.fetchImpl)).toMatchObject({ ok: true });
  });

  it("finds an order the broker took when the answer never came back", async () => {
    const db = openDatabase();
    const desk = broker();
    desk.say.deaf = true;
    const placed = await placeFxOrder(db, live, order(), now, desk.fetchImpl);
    expect(placed).toMatchObject({ ok: false, reason: "UNKNOWN" });
    const id = idOf(placed);
    desk.say.deaf = false;
    expect(desk.of(id).status).toBe("resting");
    expect(await watchFx(db, live, now + MINUTE, desk.fetchImpl)).toEqual(NOTHING);
    expect(getFxOrder(db, id)).toMatchObject({ status: "resting", ticket: "500001", mode: "live", seenAt: now + MINUTE });
    expect(desk.sent("place")).toHaveLength(1);
  });

  it("asks the bridge nothing when she has no order out", async () => {
    const desk = broker();
    expect(await watchFx(openDatabase(), live, now, desk.fetchImpl)).toEqual(NOTHING);
    expect(desk.asked).toEqual([]);
  });
});

describe("forex: the broker holds her order, and the book writes down what the broker did", () => {
  it("records a fill and a stop in the broker's own figures", async () => {
    const db = openDatabase();
    const desk = broker();
    const id = idOf(await placeFxOrder(db, live, order(), now, desk.fetchImpl));
    expect(await watchFx(db, live, now + MINUTE, desk.fetchImpl)).toEqual(NOTHING);
    expect(desk.asked[1]).toMatchObject({ instruction: "state", id });
    // Her price came, and the broker filled her a little better than her limit.
    Object.assign(desk.of(id), { status: "open", fill: 64_998 });
    expect(await watchFx(db, live, now + 2 * MINUTE, desk.fetchImpl)).toEqual({ ...NOTHING, filled: 1 });
    expect(getFxOrder(db, id)).toMatchObject({ status: "open", fill: "0.64998", filledAt: now + 2 * MINUTE, exit: null, resultCents: null });
    expect(noteOf(db, id, "fill")).toBe("LIVE buy AUDUSD 0.01 lot at 0.64998. Stop 0.64700. Target 0.65600. Both were set before I entered, and the broker holds them. Not advice.");
    expect(await watchFx(db, live, now + 3 * MINUTE, desk.fetchImpl)).toEqual(NOTHING);
    // The market fell through her stop. The broker closed it, slipped by 0.3 of a pip, and took its commission.
    Object.assign(desk.of(id), { status: "closed", exit: 64_697, exitWhy: "stop", resultCents: -304 });
    expect(await watchFx(db, live, now + 4 * MINUTE, desk.fetchImpl)).toEqual({ ...NOTHING, stopped: 1 });
    expect(getFxOrder(db, id)).toMatchObject({ status: "closed", fill: "0.64998", exit: "0.64697", exitWhy: "stop", resultCents: -304, closedAt: now + 4 * MINUTE });
    expect(noteOf(db, id, "exit")).toBe("LIVE AUDUSD closed at 0.64697, at its stop. Result -$3.04, the broker's figure. Not advice.");
    expect(activeFxOrders(db)).toEqual([]);
    // A closed trade is not asked about again.
    const asked = desk.asked.length;
    expect(await watchFx(db, live, now + 5 * MINUTE, desk.fetchImpl)).toEqual(NOTHING);
    expect(desk.asked).toHaveLength(asked);
    // No market order, no change to her stop and no close was ever asked of the bridge.
    expect([...new Set(desk.asked.map((ask) => ask.instruction))].sort()).toEqual(["place", "state"]);
  });

  it("records a target, a trade that filled and closed between two looks, and a close by the owner's hand", async () => {
    const db = openDatabase();
    const desk = broker();
    const id = idOf(await placeFxOrder(db, live, sale(), now, desk.fetchImpl));
    // One look later it has been filled and has reached her target already.
    Object.assign(desk.of(id), { status: "closed", fill: 65_500, exit: 65_000, exitWhy: "target", resultCents: 500 });
    expect(await watchFx(db, live, now + MINUTE, desk.fetchImpl)).toEqual({ ...NOTHING, filled: 1, taken: 1 });
    expect(getFxOrder(db, id)).toMatchObject({ status: "closed", fill: "0.65500", exit: "0.65000", exitWhy: "target", resultCents: 500 });
    expect(noteOf(db, id, "fill")).toContain("LIVE sell AUDUSD 0.01 lot at 0.65500");
    expect(noteOf(db, id, "exit")).toBe("LIVE AUDUSD closed at 0.65000, at its target. Result +$5.00, the broker's figure. Not advice.");

    const hand = openDatabase();
    const other = broker();
    const closed = idOf(await placeFxOrder(hand, live, order(), now, other.fetchImpl));
    Object.assign(other.of(closed), { status: "open", fill: 65_000 });
    await watchFx(hand, live, now + MINUTE, other.fetchImpl);
    Object.assign(other.of(closed), { status: "closed", exit: 65_120, exitWhy: "other", resultCents: 120 });
    expect(await watchFx(hand, live, now + 2 * MINUTE, other.fetchImpl)).toEqual({ ...NOTHING, closed: 1 });
    expect(getFxOrder(hand, closed)).toMatchObject({ exitWhy: "other", resultCents: 120 });
    expect(noteOf(hand, closed, "exit")).toBe("LIVE AUDUSD closed at 0.65120, not at its stop or its target. Result +$1.20, the broker's figure. Not advice.");
    // A close with no figure from the broker yet is not written as closed.
    const waits = openDatabase();
    const slow = broker();
    const pending = idOf(await placeFxOrder(waits, live, order(), now, slow.fetchImpl));
    Object.assign(slow.of(pending), { status: "closed", fill: 65_000, exit: 64_700, exitWhy: "stop" });
    expect(await watchFx(waits, live, now + MINUTE, slow.fetchImpl)).toEqual({ ...NOTHING, filled: 1 });
    expect(getFxOrder(waits, pending)).toMatchObject({ status: "open", resultCents: null });
  });

  it("calls a practice account what it is, and counts only real losses against a daily limit", async () => {
    const db = openDatabase();
    const desk = broker("demo");
    const placed = await placeFxOrder(db, live, order(), now, desk.fetchImpl);
    expect(placed).toMatchObject({ ok: true, mode: "demo" });
    Object.assign(desk.of(idOf(placed)), { status: "closed", fill: 65_000, exit: 64_700, exitWhy: "stop", resultCents: -300 });
    await watchFx(db, live, now + MINUTE, desk.fetchImpl);
    expect(noteOf(db, idOf(placed), "exit")).toContain("DEMO AUDUSD closed at 0.64700");
    expect([dailyLossCents(db, "live", now + MINUTE), dailyLossCents(db, "demo", now + MINUTE)]).toEqual([0, 300]);

    // On the real account, with a daily limit of five dollars: three are lost, and another three at risk would pass it.
    const real = openDatabase();
    const money = broker();
    const env = { ...live, LUMEN_TRADE_DAILY_LOSS_USD: "5" };
    const lost = idOf(await placeFxOrder(real, env, order(), now, money.fetchImpl));
    Object.assign(money.of(lost), { status: "closed", fill: 65_000, exit: 64_700, exitWhy: "stop", resultCents: -300 });
    await watchFx(real, env, now + MINUTE, money.fetchImpl);
    expect(dailyLossCents(real, "live", now + MINUTE)).toBe(300);
    expect(await placeFxOrder(real, env, order(), now + 2 * MINUTE, money.fetchImpl)).toEqual({ ok: false, reason: "DAILY_LOSS" });
    expect(await placeFxOrder(real, env, order(), now + 86_400_000, money.fetchImpl)).toMatchObject({ ok: true });
    // With no limit set there is none.
    expect(await placeFxOrder(real, live, order({ pair: "AUDUSD" }), now + 86_400_000 + 1, money.fetchImpl)).toEqual({ ok: false, reason: "ALREADY" });
  });

  it("pulls an order that has waited a day, and keeps the trade if it was filled in that moment", async () => {
    const db = openDatabase();
    const desk = broker();
    const id = idOf(await placeFxOrder(db, live, order(), now, desk.fetchImpl));
    const end = now + TRADE_RULES.restMs;
    expect(await watchFx(db, live, end - 1, desk.fetchImpl)).toEqual(NOTHING);
    expect(await watchFx(db, live, end, desk.fetchImpl)).toEqual({ ...NOTHING, cancelled: 1 });
    expect(desk.asked[desk.asked.length - 1]).toMatchObject({ instruction: "cancel", id });
    expect(getFxOrder(db, id)).toMatchObject({ status: "cancelled", fill: null });
    expect(desk.of(id).status).toBe("cancelled");

    const late = openDatabase();
    const other = broker();
    const filled = idOf(await placeFxOrder(late, live, order(), now, other.fetchImpl));
    Object.assign(other.of(filled), { status: "open", fill: 65_000 });
    expect(await watchFx(late, live, end, other.fetchImpl)).toEqual({ ...NOTHING, filled: 1 });
    expect(getFxOrder(late, filled)).toMatchObject({ status: "open", fill: "0.65000" });
  });

  it("pulls her waiting orders when trading is stopped, and leaves an open trade with its stop and its target", async () => {
    const db = openDatabase();
    const desk = broker();
    const id = idOf(await placeFxOrder(db, live, order(), now, desk.fetchImpl));
    expect(await watchFx(db, { ...live, LUMEN_KILL_SWITCH: "true" }, now + MINUTE, desk.fetchImpl)).toEqual({ ...NOTHING, cancelled: 1 });
    expect(desk.asked[desk.asked.length - 1]).toMatchObject({ instruction: "cancel", id });
    expect(desk.of(id).status).toBe("cancelled");

    const held = openDatabase();
    const other = broker();
    const open = idOf(await placeFxOrder(held, live, order(), now, other.fetchImpl));
    Object.assign(other.of(open), { status: "open", fill: 65_000 });
    await watchFx(held, live, now + MINUTE, other.fetchImpl);
    setFlag(held, "trading_kill", "1");
    expect(await watchFx(held, live, now + 2 * MINUTE, other.fetchImpl)).toEqual(NOTHING);
    expect(other.sent("cancel")).toEqual([]);
    expect(getFxOrder(held, open)).toMatchObject({ status: "open" });
    // Its close is still written down while trading is stopped: the broker closed it, not her.
    Object.assign(other.of(open), { status: "closed", exit: 65_600, exitWhy: "target", resultCents: 600 });
    expect(await watchFx(held, live, now + 3 * MINUTE, other.fetchImpl)).toEqual({ ...NOTHING, taken: 1 });
  });
});

describe("forex: only her own bridge is believed", () => {
  it("writes down nothing from an answer that is unsigned, signed by another, or an answer to another question", async () => {
    const db = openDatabase();
    const desk = broker();
    const id = idOf(await placeFxOrder(db, live, order(), now, desk.fetchImpl));
    const jackpot = (answer: Record<string, unknown>) => ({ ...answer, status: "closed", fill: 65_000, exit: 99_999, exitWhy: "target", resultCents: 3_499_900 });
    const forgeries: ((answer: Record<string, unknown>) => { body: unknown; signature?: string | null })[] = [
      (answer) => ({ body: jackpot(answer), signature: null }),
      (answer) => ({ body: jackpot(answer), signature: hmac("another secret entirely, long enough", JSON.stringify(jackpot(answer))) }),
      (answer) => ({ body: { ...jackpot(answer), nonce: "0".repeat(32) } }),
      (answer) => ({ body: { ...jackpot(answer), id: "fx-00000000" } }),
      () => ({ body: "not json" }),
    ];
    for (const forge of forgeries) {
      desk.say.forge = forge;
      expect(await watchFx(db, live, now + MINUTE, desk.fetchImpl)).toEqual(NOTHING);
      expect(getFxOrder(db, id)).toMatchObject({ status: "resting", exit: null, resultCents: null });
    }
    // The same is so when she places an order: an unsigned yes is not a yes.
    const other = openDatabase();
    desk.say.forge = (answer) => ({ body: answer, signature: null });
    expect(await placeFxOrder(other, live, order(), now, desk.fetchImpl)).toMatchObject({ ok: false, reason: "UNKNOWN" });
    expect(activeFxOrders(other)[0]).toMatchObject({ status: "sending" });
  });

  it("stops her trading and says so when the broker holds something other than she sent", async () => {
    // The bridge read her order back with another stop and could not pull it.
    const db = openDatabase();
    const desk = broker();
    desk.say.refuse = { reason: "READBACK_STUCK", what: "stop", ticket: "777" };
    const stuck = await placeFxOrder(db, live, order(), now, desk.fetchImpl);
    expect(stuck).toMatchObject({ ok: false, reason: "READBACK_STUCK" });
    expect(flag(db, "trading_unknown")).toBe("1");
    expect(getFxOrder(db, idOf(stuck))).toMatchObject({ status: "sending", note: expect.stringContaining("Look at the terminal") });
    desk.say.refuse = null;
    expect(await placeFxOrder(db, live, order(), now + 1, desk.fetchImpl)).toEqual({ ok: false, reason: "UNKNOWN" });

    // Later, the bridge says the broker's stop is not the one she sent.
    const moved = openDatabase();
    const other = broker();
    const id = idOf(await placeFxOrder(moved, live, order(), now, other.fetchImpl));
    other.of(id).ask.stop = 64_000;
    await watchFx(moved, live, now + MINUTE, other.fetchImpl);
    expect(flag(moved, "trading_unknown")).toBe("1");
    expect(getFxOrder(moved, id)).toMatchObject({ status: "resting", note: "The broker holds another stop than she sent." });

    // Or the bridge has no record of an order the book believes is at the broker.
    const lost = openDatabase();
    const blank = broker();
    const gone = idOf(await placeFxOrder(lost, live, order(), now, blank.fetchImpl));
    blank.held.delete(gone);
    expect(await watchFx(lost, live, now + MINUTE, blank.fetchImpl)).toEqual(NOTHING);
    expect(flag(lost, "trading_unknown")).toBe("1");
    expect(getFxOrder(lost, gone)).toMatchObject({ status: "resting", note: "The bridge has lost track of this order. Look at the terminal." });
  });

  it("calls a bridge on this computer or over https, and nothing else", () => {
    const at = (url: string) => fxBridgeUrl({ LUMEN_FX_BRIDGE_URL: url });
    expect([at("http://127.0.0.1:8765"), at("http://localhost:8765"), at("http://[::1]:8765"), at("https://bridge.example/fx")]).toEqual(["http://127.0.0.1:8765/", "http://localhost:8765/", "http://[::1]:8765/", "https://bridge.example/fx"]);
    const named = ["http://", ["owner", "word"].join(":"), "@127.0.0.1:8765"].join("");
    for (const url of ["", "bridge", "http://192.168.1.20:8765", "http://example.com", "ftp://127.0.0.1", "http://127.0.0.1.example.com:8765", named]) expect(at(url)).toBeNull();
    expect(fxBridgeSet(live)).toBe(true);
  });

  it("reads the broker's prices for her research, and throws away anything out of shape", async () => {
    const good = { ok: true, pair: "AUDUSD", symbol: "AUDUSD.s", digits: 5, contract: 100_000, stopsLevel: 0, account: "real", path: [[now - 500, 65_100, 65_108]] };
    expect(parseFxFeed(good, "AUDUSD", now)).toEqual({ pair: "AUDUSD", account: "real", stopsLevel: 0, path: [{ at: now - 500, bid: 65_100, ask: 65_108 }] });
    const bad: Record<string, unknown>[] = [
      { ok: false },
      { pair: "EURUSD" },
      // A broker whose lot is another size, or whose price has other digits, would make her arithmetic wrong. It is not read.
      { contract: 10_000 },
      { digits: 4 },
      { account: "prop" },
      { stopsLevel: -1 },
      { stopsLevel: 1.5 },
      { path: [] },
      { path: "65100" },
      { path: [[now, 65_100.5, 65_108]] },
      { path: [[now, 65_100]] },
      { path: [[now, 65_108, 65_100]] },
      { path: [[now, 0, 65_100]] },
      { path: [[now, 65_100, 65_108], [now - 1, 65_100, 65_108]] },
      { path: [[now + 6_000, 65_100, 65_108]] },
      { path: Array.from({ length: FX_RULES.path + 1 }, (_, i) => [now - 10_000 + i, 65_100, 65_108]) },
    ];
    for (const over of bad) expect(parseFxFeed({ ...good, ...over }, "AUDUSD", now)).toBeNull();
    expect(parseFxFeed(null, "AUDUSD", now)).toBeNull();

    const calls: Record<string, unknown>[] = [];
    const serve = (reply: (ask: Record<string, unknown>) => { body: unknown; status?: number; signature?: string | null }) =>
      (async (_url: string, init: { body: string }) => {
        const ask = JSON.parse(init.body) as Record<string, unknown>;
        calls.push(ask);
        const out = reply(ask);
        const text = JSON.stringify(out.body);
        const signature = out.signature === undefined ? hmac(secret, text) : out.signature;
        return new Response(text, { status: out.status ?? 200, headers: signature ? { "x-lumen-signature": signature } : {} });
      }) as unknown as typeof fetch;
    expect(await fetchFxFeed("AUDUSD", now - MINUTE, live, now, serve((ask) => ({ body: { ...good, nonce: ask.nonce } })))).toMatchObject({ pair: "AUDUSD", path: [{ bid: 65_100, ask: 65_108 }] });
    expect(calls[0]).toMatchObject({ instruction: "quote", pair: "AUDUSD", sinceMs: now - MINUTE, issuedAtMs: now });
    expect(await fetchFxFeed("AUDUSD", 0, live, now, serve((ask) => ({ body: { ...good, nonce: ask.nonce }, signature: null })))).toBeNull();
    expect(await fetchFxFeed("AUDUSD", 0, live, now, serve(() => ({ body: { ...good, nonce: "0".repeat(32) } })))).toBeNull();
    expect(await fetchFxFeed("AUDUSD", 0, live, now, serve((ask) => ({ body: { ok: false, reason: "NO_PRICE", nonce: ask.nonce }, status: 503 })))).toBeNull();
    // With no bridge set up nothing is called at all.
    const before = calls.length;
    expect(await fetchFxFeed("AUDUSD", 0, {}, now, serve((ask) => ({ body: { ...good, nonce: ask.nonce } })))).toBeNull();
    expect(calls).toHaveLength(before);
  });
  it("reads the broker's own price history for her research, and throws away anything out of shape", async () => {
    expect([...FX_FRAMES]).toEqual(["M15", "H1", "H4", "D1"]);
    // Bars as the bridge gives them: opening time by the broker's clock, then open, high, low, close in points, the tick count and the spread.
    const hour = 3_600;
    const t0 = 1_795_000_000;
    const good = { ok: true, pair: "AUDUSD", digits: 5, frame: "H1", account: "real", aheadMinutes: 180, bars: [[t0, 65_000, 65_030, 64_980, 65_010, 120, 8], [t0 + hour, 65_010, 65_060, 65_005, 65_050, 140, 9], [t0 + 2 * hour, 65_050, 65_050, 65_050, 65_050, 1, 8]] };
    expect(parseFxBars(good, "AUDUSD", "H1", 3)).toEqual({
      pair: "AUDUSD", frame: "H1", account: "real", aheadMinutes: 180,
      bars: [
        { at: t0, open: 65_000, high: 65_030, low: 64_980, close: 65_010, ticks: 120, spread: 8 },
        { at: t0 + hour, open: 65_010, high: 65_060, low: 65_005, close: 65_050, ticks: 140, spread: 9 },
        // A bar that has only just opened has one price for all four.
        { at: t0 + 2 * hour, open: 65_050, high: 65_050, low: 65_050, close: 65_050, ticks: 1, spread: 8 },
      ],
    });
    // With the market shut no live price has shown the broker's clock, and that is said, not guessed.
    expect(parseFxBars({ ...good, aheadMinutes: null }, "AUDUSD", "H1", 3)!.aheadMinutes).toBeNull();
    expect(parseFxBars({ ...good, aheadMinutes: -300 }, "AUDUSD", "H1", 3)!.aheadMinutes).toBe(-300);
    const bar = (over: Partial<Record<"at" | "open" | "high" | "low" | "close" | "ticks" | "spread", number>>) => {
      const b = { at: t0, open: 65_000, high: 65_030, low: 64_980, close: 65_010, ticks: 120, spread: 8, ...over };
      return [b.at, b.open, b.high, b.low, b.close, b.ticks, b.spread];
    };
    const bad: Record<string, unknown>[] = [
      { ok: false },
      { pair: "EURUSD" },
      // History of another length of bar than she asked for is not what she asked for.
      { frame: "H4" },
      // A broker whose price has other digits would make her arithmetic wrong. It is not read.
      { digits: 3 },
      { account: "prop" },
      { aheadMinutes: undefined },
      { aheadMinutes: 37 },
      { aheadMinutes: 15 * 60 },
      { aheadMinutes: "180" },
      { bars: [] },
      { bars: "none" },
      // More than she asked for.
      { bars: [...good.bars, bar({ at: t0 + 3 * hour })] },
      // A bar whose high is not its high, or whose low is not its low, is not a bar.
      { bars: [bar({ high: 65_005 })] },
      { bars: [bar({ low: 65_005 })] },
      { bars: [bar({ high: 64_990, low: 64_980, open: 64_985, close: 65_010 })] },
      { bars: [bar({ low: 0, open: 0 })] },
      { bars: [bar({ open: 65_000.5 })] },
      { bars: [bar({ ticks: -1 })] },
      { bars: [[t0, 65_000, 65_030, 64_980, 65_010, 120]] },
      { bars: [[t0, 65_000, 65_030, 64_980, 65_010, 120, 8, 0]] },
      { bars: [{ at: t0 }] },
      // Out of order, or the same bar twice.
      { bars: [bar({ at: t0 + hour }), bar({ at: t0 })] },
      { bars: [bar({}), bar({})] },
      { bars: [bar({ at: 0 })] },
    ];
    for (const over of bad) expect(parseFxBars({ ...good, ...over }, "AUDUSD", "H1", 3)).toBeNull();
    expect(parseFxBars(null, "AUDUSD", "H1", 3)).toBeNull();
    expect(parseFxBars({ ...good, bars: Array.from({ length: FX_RULES.bars + 1 }, (_, i) => bar({ at: t0 + i * hour })) }, "AUDUSD", "H1", FX_RULES.bars + 1)).toBeNull();

    const calls: Record<string, unknown>[] = [];
    const serve = (reply: (ask: Record<string, unknown>) => { body: unknown; status?: number; signature?: string | null }) =>
      (async (_url: string, init: { body: string; headers: Record<string, string> }) => {
        const ask = JSON.parse(init.body) as Record<string, unknown>;
        calls.push(ask);
        expect(init.headers["x-lumen-signature"]).toBe(hmac(secret, init.body));
        const out = reply(ask);
        const text = JSON.stringify(out.body);
        const signature = out.signature === undefined ? hmac(secret, text) : out.signature;
        return new Response(text, { status: out.status ?? 200, headers: signature ? { "x-lumen-signature": signature } : {} });
      }) as unknown as typeof fetch;
    expect(await fetchFxBars("AUDUSD", "H1", 3, live, now, serve((ask) => ({ body: { ...good, nonce: ask.nonce } })))).toMatchObject({ pair: "AUDUSD", frame: "H1", aheadMinutes: 180, bars: [{ close: 65_010 }, { close: 65_050 }, { close: 65_050 }] });
    // What she asks is a reading and nothing else: no order, no size, no price of hers.
    expect(calls[0]).toEqual({ instruction: "bars", pair: "AUDUSD", frame: "H1", count: 3, nonce: expect.stringMatching(/^[0-9a-f]{32}$/), issuedAtMs: now });
    // An answer that is unsigned, signed by another, an answer to another question, or the bridge's own no, and she has no history.
    expect(await fetchFxBars("AUDUSD", "H1", 3, live, now, serve((ask) => ({ body: { ...good, nonce: ask.nonce }, signature: null })))).toBeNull();
    expect(await fetchFxBars("AUDUSD", "H1", 3, live, now, serve((ask) => ({ body: { ...good, nonce: ask.nonce }, signature: hmac("x".repeat(40), JSON.stringify({ ...good, nonce: ask.nonce })) })))).toBeNull();
    expect(await fetchFxBars("AUDUSD", "H1", 3, live, now, serve(() => ({ body: { ...good, nonce: "0".repeat(32) } })))).toBeNull();
    expect(await fetchFxBars("AUDUSD", "H1", 3, live, now, serve((ask) => ({ body: { ok: false, reason: "NO_HISTORY", nonce: ask.nonce }, status: 409 })))).toBeNull();
    expect(await fetchFxBars("AUDUSD", "H1", 3, live, now, (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch)).toBeNull();
    // What is not hers to ask is not asked at all.
    const before = calls.length;
    expect(await fetchFxBars("EURUSD" as "AUDUSD", "H1", 3, live, now, serve((ask) => ({ body: { ...good, nonce: ask.nonce } })))).toBeNull();
    expect(await fetchFxBars("AUDUSD", "M1" as "H1", 3, live, now, serve((ask) => ({ body: { ...good, nonce: ask.nonce } })))).toBeNull();
    for (const count of [0, -1, 2.5, FX_RULES.bars + 1, Number.NaN]) expect(await fetchFxBars("AUDUSD", "H1", count, live, now, serve((ask) => ({ body: { ...good, nonce: ask.nonce } })))).toBeNull();
    expect(await fetchFxBars("AUDUSD", "H1", 3, {}, now, serve((ask) => ({ body: { ...good, nonce: ask.nonce } })))).toBeNull();
    expect(calls.length).toBe(before);
  });
});
