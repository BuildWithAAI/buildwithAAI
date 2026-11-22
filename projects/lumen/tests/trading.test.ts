import { grantLiveTrading } from "./helpers/ladder";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/db";
import { setFlag } from "../src/db/db";
import { composeThought } from "../src/integrations/telegramOwner";
import { PLACE_IDS } from "../src/world/places";
import { addVenue, recordReading } from "../src/economy/economy";
import { activeOrders, evaluateTrade, getOrder, judgeQuote, parseDexQuote, placeOrder, proposeTrade, stakeCents, tape, tradeTick, TRADE_RULES, watchOrders, type TradeOrder, type TradeProposal } from "../src/trading/book";

const now = Date.UTC(2026, 10, 9, 18);
const mint = "So11111111111111111111111111111111111111112";

function proposal(over: Partial<TradeProposal> = {}): TradeProposal {
  return {
    mint,
    symbol: "SOL",
    side: "buy",
    usdCents: 500,
    thesis: "the tape went quiet and I wanted a small paper mark",
    exitPlan: "leave if the public quote falls",
    slippageBps: 50,
    influencedByVisitor: false,
    influencedByWeb: false,
    influencedByTelegram: false,
    ...over,
  };
}

const env = {
  LUMEN_TRADE_MAX_USD: "20",
  LUMEN_TRADE_DAILY_LOSS_USD: "20",
  LUMEN_TRADE_MAX_SLIPPAGE_BPS: "100",
  LUMEN_RUG_LIQUIDITY_USD: "1000",
};

function quote(priceUsd: string, priceSol: string) {
  return parseDexQuote({
    pairs: [{ priceUsd, priceNative: priceSol, liquidity: { usd: 50_000 }, baseToken: { address: mint, symbol: "SOL" } }],
  }, mint, now)!;
}

describe("paper trading", () => {
  it("fills from the quote, blocks the caps and the kill switch, and stays paper without the live switch", async () => {
    expect(PLACE_IDS).toContain("solana-saloon");
    expect(PLACE_IDS).toContain("trading-floor");
    const db = grantLiveTrading(openDatabase());
    expect(evaluateTrade(proposal(), env, db, "ok")).toEqual({ ok: true, mode: "paper" });
    expect(evaluateTrade(proposal(), { ...env, LUMEN_TRADING_LIVE: "true" }, db, "ok")).toEqual({ ok: false, reason: "NO_SIGNER" });
    expect(evaluateTrade(proposal(), { ...env, LUMEN_TRADING_LIVE: "true", LUMEN_TRADE_SIGNER_URL: "https://signer.example/trade" }, db, "ok").ok).toBe(true);
    expect(evaluateTrade(proposal({ usdCents: 5_000 }), env, db, "ok").reason).toBe("CAP");
    expect(evaluateTrade(proposal({ influencedByTelegram: true }), env, db, "ok").reason).toBe("INFLUENCE");
    expect(evaluateTrade(proposal(), { ...env, LUMEN_KILL_SWITCH: "true" }, db, "ok").reason).toBe("KILL_SWITCH");
    setFlag(db, "kill", "1");
    expect(evaluateTrade(proposal(), env, db, "ok").reason).toBe("KILL_SWITCH");
    setFlag(db, "kill", "0");
    expect(judgeQuote({ liquidityUsd: 10, labels: [] }, 1000)).toBe("RUG");
    expect(judgeQuote({ liquidityUsd: 50_000, labels: ["honeypot"] }, 1000)).toBe("HONEYPOT");
    const bought = await proposeTrade(db, env, proposal(), quote("150", "1"), now);
    expect(bought).toMatchObject({ ok: true, mode: "paper" });
    const sold = await proposeTrade(db, env, proposal({ side: "sell", usdCents: 600 }), quote("180", "1.2"), now + 1000);
    expect(sold.ok).toBe(true);
    const board = tape(db);
    expect(board.mode).toBe("PAPER");
    expect(board.quotes[0]?.priceUsd).toBe("180");
    expect(board.pnl.usdCents).toBe(100);
    expect(board.history[0]?.thesis).toContain("paper mark");
    const paused = await proposeTrade(db, { ...env, LUMEN_TRADING_LIVE: "true", LUMEN_TRADE_SIGNER_URL: "https://signer.example/trade" }, proposal({ side: "buy" }), quote("150", "1"), now, async () => Response.json({ unknown: true }));
    expect(paused).toEqual({ ok: false, reason: "UNKNOWN" });
    expect(evaluateTrade(proposal(), env, db, "ok").reason).toBe("UNKNOWN");
    const thought = composeThought({
      emotions: { joy: 0.2, calm: 0.8, curiosity: 0.1, loneliness: 0, frustration: 0, pride: 0, boredom: 0, worry: 0 },
      memory: null,
      buildName: null,
      wondering: null,
      tradeNote: "On paper I took SOL because the tape went quiet",
    });
    expect(thought).toContain("not advice");
    expect(thought).not.toMatch(/you should buy/i);
  });
});

describe("her trading rules", () => {
  const other = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
  const order = (over: Partial<TradeOrder> = {}): TradeOrder => ({ mint, symbol: "SOL", limitUsd: "150", stopUsd: "135", targetUsd: "180", thesis: "volume has built for three days above a level it held twice", influencedByVisitor: false, influencedByWeb: false, influencedByTelegram: false, ...over });
  const at = (priceUsd: string) => quote(priceUsd, String(Number(priceUsd) / 150));
  const board = (db: ReturnType<typeof openDatabase>) => activeOrders(db).map((item) => [item.symbol, item.status]);

  it("needs no settings: a trade is three dollars, at her limit, with a stop and a target", async () => {
    const db = openDatabase();
    expect(TRADE_RULES.stakeCents).toBe(300);
    expect([stakeCents({}), stakeCents({ LUMEN_TRADE_USD: "5" }), stakeCents({ LUMEN_TRADE_USD: "lots" })]).toEqual([300, 500, 300]);
    // The price is already under her limit, so it is filled now, at the price it is and not at her limit.
    const placed = await placeOrder(db, {}, order(), at("148"), now);
    expect(placed).toMatchObject({ ok: true, mode: "paper", status: "open" });
    expect(getOrder(db, (placed as { id: string }).id)).toMatchObject({ usdCents: 300, limitUsd: "150", stopUsd: "135", targetUsd: "180", fillUsd: "148", status: "open" });
    expect(tape(db).positions).toEqual([{ symbol: "SOL", usdCents: 300, solMicro: expect.any(Number) }]);
    expect(tape(db).history[0]).toMatchObject({ side: "buy", exitPlan: "Stop at 135. Target at 180. Both were set before I entered." });
    // The size is not hers to send: with nothing set, the gate takes no trade over three dollars.
    expect(evaluateTrade(proposal({ usdCents: 301 }), {}, db, "ok")).toEqual({ ok: false, reason: "CAP" });
    expect(evaluateTrade(proposal({ usdCents: 300 }), {}, db, "ok")).toEqual({ ok: true, mode: "paper" });
  });

  it("refuses an order without proper levels or without her reasons, and a second one in the same coin", async () => {
    const db = openDatabase();
    for (const bad of [{ stopUsd: "150" }, { stopUsd: "160" }, { targetUsd: "150" }, { targetUsd: "140" }, { stopUsd: "0" }, { limitUsd: "-1" }, { limitUsd: "1e3" }, { stopUsd: "" }, { targetUsd: "soon" }]) expect(await placeOrder(db, {}, order(bad), at("148"), now)).toEqual({ ok: false, reason: "LEVELS" });
    expect(await placeOrder(db, {}, order({ thesis: "vibes" }), at("148"), now)).toEqual({ ok: false, reason: "NO_THESIS" });
    expect(await placeOrder(db, {}, order({ influencedByWeb: true }), at("148"), now)).toEqual({ ok: false, reason: "INFLUENCE" });
    expect(await placeOrder(db, { LUMEN_KILL_SWITCH: "true" }, order(), at("148"), now)).toEqual({ ok: false, reason: "KILL_SWITCH" });
    expect(await placeOrder(db, {}, order(), parseDexQuote({ pairs: [{ priceUsd: "148", priceNative: "1", liquidity: { usd: 100 }, baseToken: { address: mint, symbol: "SOL" } }] }, mint, now)!, now)).toEqual({ ok: false, reason: "RUG" });
    expect(activeOrders(db)).toEqual([]);
    expect((await placeOrder(db, {}, order(), at("160"), now)).ok).toBe(true);
    expect(await placeOrder(db, {}, order(), at("160"), now + 1)).toEqual({ ok: false, reason: "ALREADY" });
  });

  it("waits for her price, and is cancelled if it does not come in a day", async () => {
    const db = openDatabase();
    const placed = (await placeOrder(db, {}, order(), at("160"), now)) as { id: string };
    expect(getOrder(db, placed.id)).toMatchObject({ status: "resting", fillUsd: null, expiresAt: now + TRADE_RULES.restMs });
    expect(tape(db).positions).toEqual([]);
    // Above her limit nothing happens. With no quote nothing happens.
    expect(await tradeTick(db, {}, () => at("151"), now + 60_000)).toEqual({ filled: 0, stopped: 0, taken: 0, expired: 0 });
    expect(await tradeTick(db, {}, () => null, now + 120_000)).toEqual({ filled: 0, stopped: 0, taken: 0, expired: 0 });
    // The price falls through her limit between two looks. She is filled at her limit, not at the lower price she would not have got.
    expect(await tradeTick(db, {}, () => at("146"), now + 180_000)).toMatchObject({ filled: 1 });
    expect(getOrder(db, placed.id)).toMatchObject({ status: "open", fillUsd: "150" });
    // Another order never sees its price, and a day later it is gone.
    const late = (await placeOrder(db, {}, order({ mint: other, limitUsd: "1", stopUsd: "0.9", targetUsd: "1.5" }), { ...at("2"), symbol: "BONK" }, now)) as { id: string };
    expect(await tradeTick(db, {}, () => at("152"), now + TRADE_RULES.restMs)).toMatchObject({ expired: 1, filled: 0 });
    expect(getOrder(db, late.id)).toMatchObject({ status: "cancelled", fillUsd: null });
    expect(board(db)).toEqual([["SOL", "open"]]);
  });

  it("sells at the stop with no say from her, at whatever the price is by then", async () => {
    const db = openDatabase();
    const placed = (await placeOrder(db, {}, order(), at("150"), now)) as { id: string };
    // Between the stop and the target nothing is done.
    expect(await tradeTick(db, {}, () => at("136"), now + 60_000)).toEqual({ filled: 0, stopped: 0, taken: 0, expired: 0 });
    // The price drops straight past the stop at 135 to 120. It is sold at 120: three dollars became two dollars forty.
    expect(await tradeTick(db, {}, () => at("120"), now + 120_000)).toMatchObject({ stopped: 1, taken: 0 });
    expect(getOrder(db, placed.id)).toMatchObject({ status: "closed", exitWhy: "stop", exitUsd: "120", resultCents: -60 });
    expect(tape(db).pnl.usdCents).toBe(-60);
    expect(tape(db).positions).toEqual([]);
    // There is nothing in the book that moves a stop or a target once a trade is on.
    expect(activeOrders(db)).toEqual([]);
  });

  it("sells at the target, at the target", async () => {
    const db = openDatabase();
    const placed = (await placeOrder(db, {}, order(), at("150"), now)) as { id: string };
    // The price jumps past the target at 180 to 200. A limit sale is filled at its limit: three dollars became three sixty.
    expect(await tradeTick(db, {}, () => at("200"), now + 60_000)).toMatchObject({ taken: 1, stopped: 0 });
    expect(getOrder(db, placed.id)).toMatchObject({ status: "closed", exitWhy: "target", exitUsd: "180", resultCents: 60 });
    expect(tape(db).pnl.usdCents).toBe(60);
    // A new order in the same coin can be placed once the last one is closed.
    expect((await placeOrder(db, {}, order(), at("150"), now + 120_000)).ok).toBe(true);
  });

  it("does nothing at all while the kill switch is on", async () => {
    const db = openDatabase();
    const placed = (await placeOrder(db, {}, order(), at("150"), now)) as { id: string };
    setFlag(db, "trading_kill", "1");
    expect(await tradeTick(db, {}, () => at("100"), now + 60_000)).toEqual({ filled: 0, stopped: 0, taken: 0, expired: 0 });
    expect(getOrder(db, placed.id)!.status).toBe("open");
    setFlag(db, "trading_kill", "0");
    expect(await tradeTick(db, {}, () => at("100"), now + 120_000)).toMatchObject({ stopped: 1 });
  });

  it("reads a quote only for coins she has an order in", async () => {
    const db = openDatabase();
    const asked: string[] = [];
    const feed = (async (url: string | URL | Request) => {
      asked.push(String(url));
      return Response.json({ pairs: [{ priceUsd: "149", priceNative: "1", liquidity: { usd: 50_000 }, baseToken: { address: mint, symbol: "SOL" } }] });
    }) as typeof fetch;
    expect(await watchOrders(db, {}, now, feed)).toEqual({ filled: 0, stopped: 0, taken: 0, expired: 0 });
    expect(asked).toEqual([]);
    await placeOrder(db, {}, order(), at("160"), now);
    expect(await watchOrders(db, {}, now + 60_000, feed)).toMatchObject({ filled: 1 });
    expect(asked).toEqual([`https://api.dexscreener.com/latest/dex/tokens/${mint}`]);
  });

  it("live, her money is her limit, and the signer is told her limit, her target and that a stop is a stop", async () => {
    const db = openDatabase();
    const live = { LUMEN_TRADING_LIVE: "true", LUMEN_TRADE_SIGNER_URL: "https://signer.example/trade", LUMEN_TRADE_SIGNER_SECRET: "s".repeat(32) };
    const sent: Record<string, unknown>[] = [];
    const signer = (async (_url: string | URL | Request, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Response.json({ signature: `sig${sent.length}` });
    }) as typeof fetch;
    // With no money in a trading venue she cannot trade live at all.
    expect(await placeOrder(db, live, order(), at("150"), now, signer)).toEqual({ ok: false, reason: "LADDER_CAP" });
    addVenue(db, { id: "float", bookId: "company", name: "Trading float", kind: "exchange" }, Date.now());
    // Five dollars is room for one three-dollar trade, and not for two.
    recordReading(db, { venueId: "float", valueCents: 500, source: "owner" }, Date.now());
    const first = (await placeOrder(db, live, order(), at("160"), now, signer)) as { id: string };
    expect(getOrder(db, first.id)).toMatchObject({ mode: "live", status: "resting" });
    expect(await placeOrder(db, live, order({ mint: other }), { ...at("160"), symbol: "BONK" }, now, signer)).toEqual({ ok: false, reason: "BALANCE" });
    expect(sent).toEqual([]);
    // Her price comes. The signer is asked to buy three dollars' worth for no more than her limit.
    expect(await tradeTick(db, live, () => at("149"), now + 60_000, signer)).toMatchObject({ filled: 1 });
    expect(sent[0]).toMatchObject({ instruction: "swap", side: "buy", mint, usdCents: 300, limitUsd: "150" });
    // The stop: sold at once, with room to get out.
    expect(await tradeTick(db, live, () => at("130"), now + 120_000, signer)).toMatchObject({ stopped: 1 });
    expect(sent[1]).toMatchObject({ side: "sell", reason: "stop", maxSlippageBps: TRADE_RULES.stopSlippageBps });
    expect(getOrder(db, first.id)).toMatchObject({ status: "closed", exitWhy: "stop" });
    // A target is a limit sale: no less than her price.
    const second = (await placeOrder(db, live, order(), at("150"), now + 180_000, signer)) as { id: string };
    expect(await tradeTick(db, live, () => at("181"), now + 240_000, signer)).toMatchObject({ taken: 1 });
    expect(sent[3]).toMatchObject({ side: "sell", reason: "target", minUsd: "180" });
    expect(getOrder(db, second.id)).toMatchObject({ status: "closed", exitWhy: "target", resultCents: 60 });
    // If the signer's answer is unclear, the trade is left as it is and live trading waits for the owner.
    const third = (await placeOrder(db, live, order(), at("150"), now + 300_000, signer)) as { id: string };
    expect(await tradeTick(db, live, () => at("130"), now + 360_000, (async () => Response.json({ unknown: true })) as typeof fetch)).toMatchObject({ stopped: 0 });
    expect(getOrder(db, third.id)!.status).toBe("open");
    expect(await tradeTick(db, live, () => at("130"), now + 420_000, signer)).toEqual({ filled: 0, stopped: 0, taken: 0, expired: 0 });
    // The owner clears the pause, and the stop is tried again.
    setFlag(db, "trading_unknown", "0");
    expect(await tradeTick(db, live, () => at("130"), now + 480_000, signer)).toMatchObject({ stopped: 1 });
    // An unclear answer to a buy is different: the order is dropped and not tried again, because a second try could buy twice.
    const fourth = (await placeOrder(db, live, order(), at("160"), now + 540_000, signer)) as { id: string };
    expect(await tradeTick(db, live, () => at("149"), now + 600_000, (async () => Response.json({ unknown: true })) as typeof fetch)).toMatchObject({ filled: 0 });
    expect(getOrder(db, fourth.id)).toMatchObject({ status: "cancelled", fillUsd: null });
    setFlag(db, "trading_unknown", "0");
    expect(await tradeTick(db, live, () => at("149"), now + 660_000, signer)).toEqual({ filled: 0, stopped: 0, taken: 0, expired: 0 });
  });
});
