import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { openDatabase, setFlag } from "../src/db/db";
import { TRADE_RULES, dailyLossCents } from "../src/trading/book";
import { FX_PAIRS, FX_RULES, activeFxOrders, evaluateFx, fetchFxFeed, fxBridgeUrl, fxRules, fxTick, getFxOrder, parseFxFeed, placeFxOrder, pointsToCents, stopPoints, watchFx, type FxFeed, type FxOrder } from "../src/trading/forex";

// A Monday, 03:00 UTC. Prices are in points: 65000 is 0.65000, and ten points are a pip.
const now = Date.UTC(2026, 10, 23, 3);
const SPREAD = 8;

type Step = [at: number, bid: number, ask?: number];
function feed(steps: Step[], over: Partial<FxFeed> = {}): FxFeed {
  return { pair: "AUDUSD", account: "demo", stopsLevel: 0, path: steps.map(([at, bid, ask]) => ({ at, bid, ask: ask ?? bid + SPREAD })), ...over };
}
const market = (bid: number, at = now) => feed([[at, bid]]);
const order = (over: Partial<FxOrder> = {}): FxOrder => ({ pair: "AUDUSD", side: "buy", limit: "0.65000", target: "0.65600", thesis: "the price has held this level three times this week", influencedByVisitor: false, influencedByWeb: false, influencedByTelegram: false, ...over });
const sale = (over: Partial<FxOrder> = {}): FxOrder => order({ side: "sell", limit: "0.65500", target: "0.65000", ...over });
const idOf = (result: unknown) => (result as { id: string }).id;
const NOTHING = { filled: 0, stopped: 0, taken: 0, expired: 0 };

/** A buy at 0.65000 that has been filled: stop 0.64700, target 0.65600. */
function long(db: ReturnType<typeof openDatabase>, env: Record<string, string> = {}): string {
  const id = idOf(placeFxOrder(db, env, order(), market(65_100), now));
  expect(fxTick(db, env, () => feed([[now + 1_000, 64_990]]), now + 1_000)).toMatchObject({ filled: 1 });
  return id;
}

/** A sale at 0.65500 that has been filled: stop 0.65800, target 0.65000. */
function short(db: ReturnType<typeof openDatabase>): string {
  const id = idOf(placeFxOrder(db, {}, sale(), market(65_400), now));
  expect(fxTick(db, {}, () => feed([[now + 1_000, 65_500]]), now + 1_000)).toMatchObject({ filled: 1 });
  return id;
}

describe("forex: the owner's rules", () => {
  it("is 0.01 lot with a stop where three dollars is lost, which on AUDUSD is 30 pips", () => {
    expect(FX_PAIRS.AUDUSD).toEqual({ digits: 5, contract: 100_000 });
    expect(fxRules({})).toEqual({ centiLots: 1, riskCents: 300 });
    expect(stopPoints("AUDUSD", fxRules({}))).toBe(300);
    // On 0.01 lot a pip is ten cents, so thirty of them are the three dollars.
    expect([pointsToCents("AUDUSD", 1, 10), pointsToCents("AUDUSD", 1, 300)]).toEqual([10, 300]);

    const db = openDatabase();
    const bought = placeFxOrder(db, {}, order({ limit: "0.65" }), market(65_100), now);
    expect(bought).toMatchObject({ ok: true, mode: "paper", status: "resting", stop: "0.64700" });
    expect(getFxOrder(db, idOf(bought))).toMatchObject({ pair: "AUDUSD", side: "buy", lots: "0.01", riskCents: 300, limit: "0.65000", stop: "0.64700", target: "0.65600", status: "resting", fill: null, expiresAt: now + TRADE_RULES.restMs });

    // A sale has its stop the same distance over her entry.
    const sold = placeFxOrder(openDatabase(), {}, sale(), market(65_400), now);
    expect(sold).toMatchObject({ ok: true, stop: "0.65800" });
  });

  it("follows the figures the owner sets, and never loses more at the stop than he said", () => {
    expect(fxRules({ LUMEN_FX_LOTS: "0.02", LUMEN_FX_RISK_USD: "5" })).toEqual({ centiLots: 2, riskCents: 500 });
    expect(fxRules({ LUMEN_FX_LOTS: "lots", LUMEN_FX_RISK_USD: "-3" })).toEqual({ centiLots: 1, riskCents: 300 });
    expect(fxRules({ LUMEN_FX_LOTS: "0", LUMEN_FX_RISK_USD: "0" })).toEqual({ centiLots: 1, riskCents: 300 });
    // Twice the size, half the distance. A bigger loss allowed, a wider stop.
    expect(stopPoints("AUDUSD", fxRules({ LUMEN_FX_LOTS: "0.02" }))).toBe(150);
    expect(stopPoints("AUDUSD", fxRules({ LUMEN_FX_RISK_USD: "5" }))).toBe(500);
    // 0.07 lot does not divide three dollars evenly. The stop is rounded nearer, so the loss is $2.94 and not $3.01.
    const odd = fxRules({ LUMEN_FX_LOTS: "0.07" });
    expect(stopPoints("AUDUSD", odd)).toBe(42);
    expect(pointsToCents("AUDUSD", odd.centiLots, stopPoints("AUDUSD", odd))).toBe(294);
    // A size so large that three dollars is less than one point away cannot be traded under the rule.
    expect(placeFxOrder(openDatabase(), { LUMEN_FX_LOTS: "500" }, order(), market(65_100), now)).toEqual({ ok: false, reason: "FX_RULES" });
  });

  it("refuses an order that is not a proper one, and says why", () => {
    const db = openDatabase();
    const place = (over: Partial<FxOrder>, env: Record<string, string> = {}, prices: FxFeed | null = market(65_100)) => placeFxOrder(db, env, order(over), prices, now);
    for (const pair of ["EURUSD", "USDJPY", "audusd", "", "constructor"]) expect(place({ pair })).toEqual({ ok: false, reason: "FX_PAIR" });
    expect(place({ side: "long" as "buy" })).toEqual({ ok: false, reason: "FX_SIDE" });
    // A target has to be on the side she profits on, and a price has to be a plain price.
    for (const bad of [{ target: "0.65000" }, { target: "0.64000" }, { limit: "1e3" }, { limit: "-0.65" }, { limit: "" }, { target: "soon" }, { limit: "0.650001" }, { limit: "0" }]) expect(place(bad)).toEqual({ ok: false, reason: "LEVELS" });
    expect(placeFxOrder(db, {}, sale({ target: "0.65500" }), market(65_400), now)).toEqual({ ok: false, reason: "LEVELS" });
    expect(placeFxOrder(db, {}, sale({ target: "0.66000" }), market(65_400), now)).toEqual({ ok: false, reason: "LEVELS" });
    // A stop under zero is no stop.
    expect(place({ limit: "0.00200", target: "0.00300" }, {}, market(250))).toEqual({ ok: false, reason: "LEVELS" });
    expect(place({ thesis: "vibes" })).toEqual({ ok: false, reason: "NO_THESIS" });
    for (const flagged of [{ influencedByVisitor: true }, { influencedByWeb: true }, { influencedByTelegram: true }]) expect(place(flagged)).toEqual({ ok: false, reason: "INFLUENCE" });
    expect(place({}, { LUMEN_KILL_SWITCH: "true" })).toEqual({ ok: false, reason: "KILL_SWITCH" });
    // A broker password has no business in this app. If one is in its settings, forex stays shut.
    expect(place({}, { MT5_PASSWORD: "set" })).toEqual({ ok: false, reason: "KEY_IN_APP" });
    expect(place({}, { LUMEN_MT5_PASSWORD: "set" })).toEqual({ ok: false, reason: "KEY_IN_APP" });
    expect(activeFxOrders(db)).toEqual([]);
  });

  it("is a limit order and nothing else: her price has to be better than the market, and there has to be a market", () => {
    const db = openDatabase();
    // No price, an old price, or a price for another pair: no order.
    expect(placeFxOrder(db, {}, order(), null, now)).toEqual({ ok: false, reason: "NO_QUOTE" });
    expect(placeFxOrder(db, {}, order(), market(65_100, now - FX_RULES.freshMs - 1), now)).toEqual({ ok: false, reason: "NO_QUOTE" });
    expect(placeFxOrder(db, {}, order(), { ...market(65_100), pair: "EURUSD" as "AUDUSD" }, now)).toEqual({ ok: false, reason: "NO_QUOTE" });
    // The ask is 0.65008. A buy at it or over it would be a market order.
    expect(placeFxOrder(db, {}, order({ limit: "0.65008" }), market(65_000), now)).toEqual({ ok: false, reason: "FX_LIMIT" });
    expect(placeFxOrder(db, {}, order({ limit: "0.65100", target: "0.65700" }), market(65_000), now)).toEqual({ ok: false, reason: "FX_LIMIT" });
    expect(placeFxOrder(db, {}, order({ limit: "0.65007" }), market(65_000), now)).toMatchObject({ ok: true, status: "resting" });
    // The bid is 0.65400. A sale at it or under it would be a market order.
    const other = openDatabase();
    expect(placeFxOrder(other, {}, sale({ limit: "0.65400" }), market(65_400), now)).toEqual({ ok: false, reason: "FX_LIMIT" });
    expect(placeFxOrder(other, {}, sale({ limit: "0.65300" }), market(65_400), now)).toEqual({ ok: false, reason: "FX_LIMIT" });
    expect(placeFxOrder(other, {}, sale({ limit: "0.65401" }), market(65_400), now)).toMatchObject({ ok: true, status: "resting" });
    // One trade in a pair at a time.
    expect(placeFxOrder(other, {}, sale(), market(65_400), now + 1)).toEqual({ ok: false, reason: "ALREADY" });
  });

  it("keeps the distance the broker asks for between an order and the market, and between an order and its target", () => {
    const near = feed([[now, 65_100]], { stopsLevel: 50 });
    // The ask is 0.65108, so a buy has to wait at 0.65058 or under.
    expect(placeFxOrder(openDatabase(), {}, order({ limit: "0.65059" }), near, now)).toEqual({ ok: false, reason: "FX_LIMIT" });
    expect(placeFxOrder(openDatabase(), {}, order({ limit: "0.65058" }), near, now)).toMatchObject({ ok: true });
    expect(placeFxOrder(openDatabase(), {}, order({ target: "0.65049" }), near, now)).toEqual({ ok: false, reason: "LEVELS" });
    expect(placeFxOrder(openDatabase(), {}, order({ target: "0.65050" }), near, now)).toMatchObject({ ok: true });
    // A broker that wants more room than her stop has cannot be traded under the rule.
    expect(placeFxOrder(openDatabase(), {}, order(), feed([[now, 65_500]], { stopsLevel: 301 }), now)).toEqual({ ok: false, reason: "LEVELS" });
  });
});

describe("forex: what the book does with her order", () => {
  it("fills a buy at her limit when the ask comes down to it, not when the bid does", () => {
    const db = openDatabase();
    const id = idOf(placeFxOrder(db, {}, order(), market(65_100), now));
    // The bid is under her limit and the ask is not. Nobody will sell to her at 0.65000 yet.
    expect(fxTick(db, {}, () => feed([[now + 1_000, 64_995]]), now + 1_000)).toEqual(NOTHING);
    expect(fxTick(db, {}, () => null, now + 2_000)).toEqual(NOTHING);
    expect(fxTick(db, {}, () => feed([[now + 3_000, 64_980]]), now + 3_000)).toEqual({ ...NOTHING, filled: 1 });
    expect(getFxOrder(db, id)).toMatchObject({ status: "open", fill: "0.65000", filledAt: now + 3_000, exit: null, resultCents: null });
    const row = db.prepare("SELECT note, amount_cents FROM ledger_entries WHERE idempotency_key = ?").get(`fx:${id}:fill`) as { note: string; amount_cents: number };
    expect(row).toEqual({ note: "PAPER buy AUDUSD 0.01 lot at 0.65000. Stop 0.64700. Target 0.65600. Both were set before I entered. Not advice.", amount_cents: 0 });
  });

  it("takes three dollars at the stop with no say from her, and more if the market jumps past it", () => {
    const db = openDatabase();
    const id = long(db);
    expect(fxTick(db, {}, () => feed([[now + 2_000, 64_701]]), now + 2_000)).toEqual(NOTHING);
    expect(fxTick(db, {}, () => feed([[now + 3_000, 64_700]]), now + 3_000)).toEqual({ ...NOTHING, stopped: 1 });
    expect(getFxOrder(db, id)).toMatchObject({ status: "closed", exit: "0.64700", exitWhy: "stop", resultCents: -300, closedAt: now + 3_000 });
    expect(activeFxOrders(db)).toEqual([]);
    expect((db.prepare("SELECT note FROM ledger_entries WHERE idempotency_key = ?").get(`fx:${id}:exit`) as { note: string }).note).toBe("PAPER AUDUSD closed at 0.64700, at its stop. Result -$3.00. Not advice.");

    // Over a weekend the price opens 5 pips under her stop. She is out at that price, and it cost $3.50.
    const gap = openDatabase();
    const jumped = long(gap);
    expect(fxTick(gap, {}, () => feed([[now + 2_000, 64_650]]), now + 2_000)).toEqual({ ...NOTHING, stopped: 1 });
    expect(getFxOrder(gap, jumped)).toMatchObject({ exit: "0.64650", exitWhy: "stop", resultCents: -350 });
  });

  it("takes the target at the target, and no more than the target", () => {
    const db = openDatabase();
    const id = long(db);
    expect(fxTick(db, {}, () => feed([[now + 2_000, 65_599]]), now + 2_000)).toEqual(NOTHING);
    expect(fxTick(db, {}, () => feed([[now + 3_000, 65_640]]), now + 3_000)).toEqual({ ...NOTHING, taken: 1 });
    expect(getFxOrder(db, id)).toMatchObject({ status: "closed", exit: "0.65600", exitWhy: "target", resultCents: 600 });
  });

  it("mirrors all of it for a sale: filled on the bid, stopped and taken on the ask", () => {
    const db = openDatabase();
    const id = idOf(placeFxOrder(db, {}, sale(), market(65_400), now));
    // The ask is at her limit and the bid is not. Nobody will buy from her at 0.65500 yet.
    expect(fxTick(db, {}, () => feed([[now + 1_000, 65_492]]), now + 1_000)).toEqual(NOTHING);
    expect(fxTick(db, {}, () => feed([[now + 2_000, 65_510]]), now + 2_000)).toEqual({ ...NOTHING, filled: 1 });
    expect(getFxOrder(db, id)).toMatchObject({ status: "open", fill: "0.65500", stop: "0.65800" });
    // She buys back at the ask. The bid is under her stop and the ask is at it: she is out.
    expect(fxTick(db, {}, () => feed([[now + 3_000, 65_791]]), now + 3_000)).toEqual(NOTHING);
    expect(fxTick(db, {}, () => feed([[now + 4_000, 65_792]]), now + 4_000)).toEqual({ ...NOTHING, stopped: 1 });
    expect(getFxOrder(db, id)).toMatchObject({ exit: "0.65800", exitWhy: "stop", resultCents: -300 });

    const won = openDatabase();
    const taken = short(won);
    expect(fxTick(won, {}, () => feed([[now + 2_000, 64_993]]), now + 2_000)).toEqual(NOTHING);
    expect(fxTick(won, {}, () => feed([[now + 3_000, 64_950]]), now + 3_000)).toEqual({ ...NOTHING, taken: 1 });
    expect(getFxOrder(won, taken)).toMatchObject({ exit: "0.65000", exitWhy: "target", resultCents: 500 });
  });

  it("misses nothing between two looks, and plays what happened in the order it happened", () => {
    const db = openDatabase();
    const id = idOf(placeFxOrder(db, {}, order(), market(65_100), now));
    // One look, a minute later. In that minute the price came to her limit, ran to her target, and then fell through her stop.
    const minute: Step[] = [[now - 10_000, 64_900], [now + 5_000, 65_050], [now + 20_000, 64_990], [now + 30_000, 65_300], [now + 40_000, 65_610], [now + 50_000, 64_000]];
    expect(fxTick(db, {}, () => feed(minute), now + 60_000)).toEqual({ ...NOTHING, filled: 1, taken: 1 });
    // The price from before she placed the order did not fill it. The fall after her target did not touch her.
    expect(getFxOrder(db, id)).toMatchObject({ status: "closed", filledAt: now + 20_000, closedAt: now + 40_000, exit: "0.65600", exitWhy: "target", resultCents: 600 });
    // The same prices looked at again change nothing.
    expect(fxTick(db, {}, () => feed(minute), now + 61_000)).toEqual(NOTHING);

    // The other way round: the stop came first.
    const lost = openDatabase();
    const stopped = idOf(placeFxOrder(lost, {}, order(), market(65_100), now));
    expect(fxTick(lost, {}, () => feed([[now + 5_000, 64_990], [now + 10_000, 64_690], [now + 20_000, 65_700]]), now + 60_000)).toEqual({ ...NOTHING, filled: 1, stopped: 1 });
    expect(getFxOrder(lost, stopped)).toMatchObject({ exit: "0.64690", exitWhy: "stop", resultCents: -310 });

    // A spread blown wide open: the ask reaches her limit while the bid is already under her stop. Filled, and out, on the one price.
    const wide = openDatabase();
    const both = idOf(placeFxOrder(wide, {}, order(), market(65_100), now));
    expect(fxTick(wide, {}, () => feed([[now + 5_000, 64_600, 64_990]]), now + 5_000)).toEqual({ ...NOTHING, filled: 1, stopped: 1 });
    expect(getFxOrder(wide, both)).toMatchObject({ fill: "0.65000", exit: "0.64600", resultCents: -400 });

    // An order still waiting remembers how far it has looked, so a later look starts from there.
    const waits = openDatabase();
    const resting = idOf(placeFxOrder(waits, {}, order(), market(65_100), now));
    fxTick(waits, {}, () => feed([[now + 5_000, 65_050], [now + 9_000, 65_060]]), now + 10_000);
    expect(getFxOrder(waits, resting)).toMatchObject({ status: "resting", seenAt: now + 9_000 });
  });

  it("cancels an order that has waited a day, and a price after its day is not for it", () => {
    const db = openDatabase();
    const id = idOf(placeFxOrder(db, {}, order(), market(65_100), now));
    const end = now + TRADE_RULES.restMs;
    expect(fxTick(db, {}, () => feed([[end + 1, 64_900]]), end + 60_000)).toEqual({ ...NOTHING, expired: 1 });
    expect(getFxOrder(db, id)).toMatchObject({ status: "cancelled", fill: null });
    // With no prices to be had at all it is still cancelled.
    const quiet = openDatabase();
    const silent = idOf(placeFxOrder(quiet, {}, order(), market(65_100), now));
    expect(fxTick(quiet, {}, () => null, end)).toEqual({ ...NOTHING, expired: 1 });
    expect(getFxOrder(quiet, silent)).toMatchObject({ status: "cancelled" });
    // Her price came a second before the day ran out, and the engine looked five minutes late. It was filled in time, so it is a trade.
    const late = openDatabase();
    const made = idOf(placeFxOrder(late, {}, order(), market(65_100), now));
    expect(fxTick(late, {}, () => feed([[end - 1_000, 64_900], [end + 1_000, 64_950]]), end + 300_000)).toEqual({ ...NOTHING, filled: 1 });
    expect(getFxOrder(late, made)).toMatchObject({ status: "open", filledAt: end - 1_000 });
  });

  it("does nothing while trading is stopped, and does not act afterwards on what happened meanwhile", () => {
    const db = openDatabase();
    const id = idOf(placeFxOrder(db, {}, order(), market(65_100), now));
    const came: Step[] = [[now + 30_000, 64_900]];
    expect(fxTick(db, { LUMEN_KILL_SWITCH: "true" }, () => feed(came), now + 60_000)).toEqual(NOTHING);
    expect(getFxOrder(db, id)).toMatchObject({ status: "resting", seenAt: now + 60_000 });
    expect(fxTick(db, {}, () => feed(came), now + 90_000)).toEqual(NOTHING);
    // An unclear answer from a signer pauses all her trading until the owner clears it. Her price coming does not fill her.
    setFlag(db, "trading_unknown", "1");
    expect(fxTick(db, {}, () => feed([[now + 100_000, 64_900]]), now + 100_000)).toEqual(NOTHING);
    setFlag(db, "trading_unknown", "0");
    expect(fxTick(db, {}, () => feed([[now + 100_000, 64_900]]), now + 110_000)).toEqual(NOTHING);
    expect(fxTick(db, {}, () => feed([[now + 120_000, 64_900]]), now + 120_000)).toEqual({ ...NOTHING, filled: 1 });
    // The desk's own kill does the same as the setting.
    setFlag(db, "trading_kill", "1");
    expect(fxTick(db, {}, () => feed([[now + 130_000, 64_000]]), now + 130_000)).toEqual(NOTHING);
    expect(getFxOrder(db, id)).toMatchObject({ status: "open" });
    expect(placeFxOrder(openDatabase(), {}, order(), market(65_100), now)).toMatchObject({ ok: true });
  });

  it("keeps one daily loss limit over coins and forex, if the owner sets one, and none if he does not", () => {
    const db = openDatabase();
    const env = { LUMEN_TRADE_DAILY_LOSS_USD: "5" };
    long(db, env);
    fxTick(db, env, () => feed([[now + 2_000, 64_700]]), now + 2_000);
    expect([dailyLossCents(db, "paper", now), dailyLossCents(db, "live", now), dailyLossCents(db, "paper", now + 86_400_000)]).toEqual([300, 0, 0]);
    // Three dollars are lost today. Another three at risk would pass his five.
    expect(evaluateFx(env, db, order(), 300, now + 3_000)).toEqual({ ok: false, reason: "DAILY_LOSS" });
    expect(placeFxOrder(db, env, order(), market(65_100, now + 3_000), now + 3_000)).toEqual({ ok: false, reason: "DAILY_LOSS" });
    expect(placeFxOrder(db, env, order(), market(65_100, now + 86_400_000), now + 86_400_000)).toMatchObject({ ok: true });
    const free = openDatabase();
    long(free);
    fxTick(free, {}, () => feed([[now + 2_000, 64_700]]), now + 2_000);
    expect(placeFxOrder(free, {}, order(), market(65_100, now + 3_000), now + 3_000)).toMatchObject({ ok: true, mode: "paper" });
  });

  it("stays on paper whatever the live switch says", () => {
    expect(evaluateFx({ LUMEN_TRADING_LIVE: "true" }, openDatabase(), order(), 300, now)).toEqual({ ok: true, mode: "paper" });
  });
});

describe("forex: prices come only from her own bridge", () => {
  const secret = "bridge-".concat("s".repeat(40));
  const env = { LUMEN_FX_BRIDGE_URL: "http://127.0.0.1:8765", LUMEN_FX_BRIDGE_SECRET: secret };
  const answerFor = (ask: Record<string, unknown>, over: Record<string, unknown> = {}) => ({ ok: true, nonce: ask.nonce, pair: "AUDUSD", symbol: "AUDUSD.s", digits: 5, contract: 100_000, stopsLevel: 0, account: "demo", path: [[now - 500, 65_100, 65_108]], ...over });
  type Reply = { status?: number; body: unknown; signature?: string | null };

  function bridge(reply: (ask: Record<string, unknown>) => Reply) {
    const calls: { url: string; body: string; headers: Record<string, string> }[] = [];
    const fetchImpl = (async (url: string, init: { body: string; headers: Record<string, string> }) => {
      calls.push({ url: String(url), body: init.body, headers: init.headers });
      const out = reply(JSON.parse(init.body) as Record<string, unknown>);
      const text = typeof out.body === "string" ? out.body : JSON.stringify(out.body);
      const signature = out.signature === undefined ? createHmac("sha256", secret).update(text).digest("hex") : out.signature;
      return new Response(text, { status: out.status ?? 200, headers: signature ? { "x-lumen-signature": signature } : {} });
    }) as unknown as typeof fetch;
    return { calls, fetchImpl };
  }

  it("reads the bridge's answer and throws away anything out of shape", () => {
    const good = answerFor({ nonce: "n" });
    expect(parseFxFeed(good, "AUDUSD", now)).toEqual({ pair: "AUDUSD", account: "demo", stopsLevel: 0, path: [{ at: now - 500, bid: 65_100, ask: 65_108 }] });
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
  });

  it("calls a bridge on this computer or over https, and nothing else", () => {
    const at = (url: string) => fxBridgeUrl({ LUMEN_FX_BRIDGE_URL: url });
    expect([at("http://127.0.0.1:8765"), at("http://localhost:8765"), at("http://[::1]:8765"), at("https://bridge.example/fx")]).toEqual(["http://127.0.0.1:8765/", "http://localhost:8765/", "http://[::1]:8765/", "https://bridge.example/fx"]);
    const named = ["http://", ["owner", "word"].join(":"), "@127.0.0.1:8765"].join("");
    for (const url of ["", "bridge", "http://192.168.1.20:8765", "http://example.com", "ftp://127.0.0.1", "http://127.0.0.1.example.com:8765", named]) expect(at(url)).toBeNull();
  });

  it("signs what it asks, and believes only an answer signed with the same secret that carries its own nonce", async () => {
    const honest = bridge((ask) => ({ body: answerFor(ask) }));
    const got = await fetchFxFeed("AUDUSD", now - 60_000, env, now, honest.fetchImpl);
    expect(got).toMatchObject({ pair: "AUDUSD", account: "demo", path: [{ bid: 65_100, ask: 65_108 }] });
    const [call] = honest.calls;
    expect(call.url).toBe("http://127.0.0.1:8765/");
    expect(JSON.parse(call.body)).toMatchObject({ instruction: "quote", pair: "AUDUSD", sinceMs: now - 60_000, issuedAtMs: now, nonce: expect.stringMatching(/^[0-9a-f]{32}$/) });
    expect(call.headers["x-lumen-signature"]).toBe(createHmac("sha256", secret).update(call.body).digest("hex"));
    // No password, login or key of any kind goes with it.
    expect(call.body).not.toMatch(/password|login|secret/i);

    const refused: Reply[] = [
      { body: {}, status: 401 },
      { body: "not json" },
    ];
    for (const reply of refused) expect(await fetchFxFeed("AUDUSD", 0, env, now, bridge(() => reply).fetchImpl)).toBeNull();
    // Unsigned, signed with another secret, or an answer to some other request.
    expect(await fetchFxFeed("AUDUSD", 0, env, now, bridge((ask) => ({ body: answerFor(ask), signature: null })).fetchImpl)).toBeNull();
    expect(await fetchFxFeed("AUDUSD", 0, env, now, bridge((ask) => ({ body: answerFor(ask), signature: createHmac("sha256", "another").update(JSON.stringify(answerFor(ask))).digest("hex") })).fetchImpl)).toBeNull();
    expect(await fetchFxFeed("AUDUSD", 0, env, now, bridge((ask) => ({ body: answerFor(ask, { nonce: "0".repeat(32) }) })).fetchImpl)).toBeNull();
    expect(await fetchFxFeed("AUDUSD", 0, env, now, bridge((ask) => ({ body: answerFor(ask, { ok: false, reason: "NO_PRICE" }), status: 503 })).fetchImpl)).toBeNull();

    // With no address, a short secret, or an address that is not hers, nothing is called at all.
    const silent = bridge((ask) => ({ body: answerFor(ask) }));
    expect(await fetchFxFeed("AUDUSD", 0, {}, now, silent.fetchImpl)).toBeNull();
    expect(await fetchFxFeed("AUDUSD", 0, { ...env, LUMEN_FX_BRIDGE_SECRET: "short" }, now, silent.fetchImpl)).toBeNull();
    expect(await fetchFxFeed("AUDUSD", 0, { ...env, LUMEN_FX_BRIDGE_URL: "http://example.com" }, now, silent.fetchImpl)).toBeNull();
    expect(silent.calls).toEqual([]);
  });

  it("asks for nothing with no order out, and otherwise for the prices since her order was last looked at", async () => {
    const db = openDatabase();
    const served = bridge((ask) => ({ body: answerFor(ask, { path: [[now + 20_000, 64_990, 64_998], [now + 40_000, 65_610, 65_618]] }) }));
    expect(await watchFx(db, env, now, served.fetchImpl)).toEqual(NOTHING);
    expect(served.calls).toEqual([]);
    const id = idOf(placeFxOrder(db, env, order(), market(65_100), now));
    expect(await watchFx(db, env, now + 60_000, served.fetchImpl)).toEqual({ ...NOTHING, filled: 1, taken: 1 });
    expect(served.calls.length).toBe(1);
    expect(JSON.parse(served.calls[0].body)).toMatchObject({ instruction: "quote", pair: "AUDUSD", sinceMs: now });
    expect(getFxOrder(db, id)).toMatchObject({ status: "closed", resultCents: 600 });
    // A bridge that is switched off is no price. Her order waits.
    const down = openDatabase();
    const waiting = idOf(placeFxOrder(down, env, order(), market(65_100), now));
    const dead = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    expect(await watchFx(down, env, now + 60_000, dead)).toEqual(NOTHING);
    expect(getFxOrder(down, waiting)).toMatchObject({ status: "resting" });
  });
});
