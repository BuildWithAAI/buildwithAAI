import { grantLiveTrading } from "./helpers/ladder";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { flag, openDatabase, setFlag } from "../src/db/db";
import { composeThought } from "../src/integrations/telegramOwner";
import { PLACE_IDS } from "../src/world/places";
import { activityFor, actsAt } from "../src/world/choose";
import { LADDER, addVenue, ensureEconomy, recordReading } from "../src/economy/economy";
import { SIGNER_SECRET_MIN, activeOrders, evaluateTrade, getOrder, judgeQuote, latestThesis, parseDexQuote, placeOrder, proposeTrade, stakeCents, tape, tradeTick, tradingLive, TRADE_RULES, watchOrders, type TradeOrder, type TradeProposal } from "../src/trading/book";
import { activeFxOrders, recentFxOrders } from "../src/trading/forex";

const now = Date.UTC(2026, 10, 9, 18);
const mint = "So11111111111111111111111111111111111111112";
const other = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

function proposal(over: Partial<TradeProposal> = {}): TradeProposal {
  return {
    mint,
    symbol: "SOL",
    side: "buy",
    usdCents: 500,
    thesis: "the tape went quiet and I wanted a small mark",
    exitPlan: "leave if the public quote falls",
    slippageBps: 50,
    influencedByVisitor: false,
    influencedByWeb: false,
    influencedByTelegram: false,
    ...over,
  };
}

const caps = {
  LUMEN_TRADE_MAX_USD: "20",
  LUMEN_TRADE_DAILY_LOSS_USD: "20",
  LUMEN_TRADE_MAX_SLIPPAGE_BPS: "100",
  LUMEN_RUG_LIQUIDITY_USD: "1000",
};

/** The signer the owner runs and the secret the two share. With these, and only these, her coin trades are real ones. */
const signerUrl = "https://signer.example/trade";
const shared = "s".repeat(SIGNER_SECRET_MIN);
const live = { LUMEN_TRADE_SIGNER_URL: signerUrl, LUMEN_TRADE_SIGNER_SECRET: shared };

function quote(priceUsd: string, priceSol: string) {
  return parseDexQuote({
    pairs: [{ priceUsd, priceNative: priceSol, liquidity: { usd: 50_000 }, baseToken: { address: mint, symbol: "SOL" } }],
  }, mint, now)!;
}

/** A signer that signs whatever it is sent, and keeps what it was sent. */
function signer() {
  const sent: Record<string, unknown>[] = [];
  const ask = (async (_url: string | URL | Request, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return Response.json({ signature: `sig${sent.length}` });
  }) as typeof fetch;
  return { sent, ask };
}

const unclear = (async () => Response.json({ unknown: true })) as typeof fetch;

/** Her books with money in a trading venue. Her money is her limit, so without it nothing can be placed. */
function funded(cents = 10_000) {
  const db = openDatabase();
  addVenue(db, { id: "float", bookId: "company", name: "Trading float", kind: "exchange" }, Date.now());
  recordReading(db, { venueId: "float", valueCents: cents, source: "owner" }, Date.now());
  return db;
}

describe("her coin trades are real ones", () => {
  it("sends a trade to the signer or places none: there is no paper book and no switch", async () => {
    expect(PLACE_IDS).toContain("solana-saloon");
    expect(PLACE_IDS).toContain("trading-floor");
    const db = grantLiveTrading(openDatabase());
    const { sent, ask } = signer();
    // With no signer there is nowhere for an order to go, and it is not kept as a pretend one.
    expect(tradingLive(caps)).toBe(false);
    expect(evaluateTrade(proposal(), caps, db, "ok")).toEqual({ ok: false, reason: "NO_SIGNER" });
    expect(await proposeTrade(db, caps, proposal(), quote("150", "1"), now, ask)).toEqual({ ok: false, reason: "NO_SIGNER" });
    expect(sent).toEqual([]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM paper_trades").get()).toEqual({ n: 0 });
    expect(tape(db, caps)).toMatchObject({ live: false, positions: [], history: [], pnl: { usdCents: 0, solMicro: 0 } });
    // The old switch decides nothing, either way.
    expect(evaluateTrade(proposal(), { ...caps, LUMEN_TRADING_LIVE: "true" }, db, "ok")).toEqual({ ok: false, reason: "NO_SIGNER" });
    expect(evaluateTrade(proposal(), { ...caps, ...live, LUMEN_TRADING_LIVE: "false" }, db, "ok")).toEqual({ ok: true, mode: "live" });
    // A signer is an https address and a secret long enough to mean something. Anything less is no signer.
    expect(evaluateTrade(proposal(), { ...caps, LUMEN_TRADE_SIGNER_URL: signerUrl }, db, "ok")).toEqual({ ok: false, reason: "NO_SIGNER" });
    expect(evaluateTrade(proposal(), { ...caps, LUMEN_TRADE_SIGNER_URL: signerUrl, LUMEN_TRADE_SIGNER_SECRET: "s".repeat(SIGNER_SECRET_MIN - 1) }, db, "ok")).toEqual({ ok: false, reason: "NO_SIGNER" });
    expect(evaluateTrade(proposal(), { ...caps, LUMEN_TRADE_SIGNER_URL: "http://signer.example/trade", LUMEN_TRADE_SIGNER_SECRET: shared }, db, "ok")).toEqual({ ok: false, reason: "NO_SIGNER" });
    expect(sent).toEqual([]);
    const env = { ...caps, ...live };
    expect(tradingLive(env)).toBe(true);
    expect(evaluateTrade(proposal(), env, db, "ok")).toEqual({ ok: true, mode: "live" });
    expect(evaluateTrade(proposal({ usdCents: 5_000 }), env, db, "ok").reason).toBe("CAP");
    expect(evaluateTrade(proposal({ influencedByTelegram: true }), env, db, "ok").reason).toBe("INFLUENCE");
    expect(evaluateTrade(proposal(), { ...env, LUMEN_KILL_SWITCH: "true" }, db, "ok").reason).toBe("KILL_SWITCH");
    expect(evaluateTrade(proposal(), { ...env, SOLANA_PRIVATE_KEY: "set" }, db, "ok").reason).toBe("KEY_IN_APP");
    setFlag(db, "kill", "1");
    expect(evaluateTrade(proposal(), env, db, "ok").reason).toBe("KILL_SWITCH");
    setFlag(db, "kill", "0");
    expect(judgeQuote({ liquidityUsd: 10, labels: [] }, 1000)).toBe("RUG");
    expect(judgeQuote({ liquidityUsd: 50_000, labels: ["honeypot"] }, 1000)).toBe("HONEYPOT");
    // A trade that passes is sent to the signer, and what the signer signed is what is written down.
    const bought = await proposeTrade(db, env, proposal(), quote("150", "1"), now, ask);
    expect(bought).toEqual({ ok: true, mode: "live", id: "sig1" });
    expect(sent[0]).toMatchObject({ instruction: "swap", network: "mainnet", side: "buy", mint, usdCents: 500 });
    const sold = await proposeTrade(db, env, proposal({ side: "sell", usdCents: 600 }), quote("180", "1.2"), now + 1000, ask);
    expect(sold).toEqual({ ok: true, mode: "live", id: "sig2" });
    expect(sent).toHaveLength(2);
    const board = tape(db, env);
    expect(board.live).toBe(true);
    expect(board.quotes[0]?.priceUsd).toBe("180");
    expect(board.pnl.usdCents).toBe(100);
    expect(board.history[0]?.thesis).toContain("small mark");
    // Every row in her books is a real trade, and says so.
    expect(db.prepare("SELECT DISTINCT mode FROM paper_trades").all()).toEqual([{ mode: "live" }]);
    expect(db.prepare("SELECT signature FROM paper_trades ORDER BY created_at").all()).toEqual([{ signature: "sig1" }, { signature: "sig2" }]);
    expect((db.prepare("SELECT note FROM ledger_entries WHERE idempotency_key LIKE 'trade:%'").all() as { note: string }[]).every((row) => row.note.startsWith("LIVE "))).toBe(true);
    expect(latestThesis(db)).toMatch(/^I left SOL because /);
    // An unclear answer from the signer stops her trading until the owner has looked.
    const paused = await proposeTrade(db, env, proposal({ side: "buy" }), quote("150", "1"), now, unclear);
    expect(paused).toEqual({ ok: false, reason: "UNKNOWN" });
    expect(evaluateTrade(proposal(), env, db, "ok").reason).toBe("UNKNOWN");
    const thought = composeThought({
      emotions: { joy: 0.2, calm: 0.8, curiosity: 0.1, loneliness: 0, frustration: 0, pride: 0, boredom: 0, worry: 0 },
      memory: null,
      buildName: null,
      wondering: null,
      tradeNote: latestThesis(db),
    });
    expect(thought).toContain("not advice");
    expect(thought).not.toMatch(/you should buy/i);
    expect(thought).not.toMatch(/paper/i);
  });

  it("says nothing of paper anywhere she can be seen or heard", () => {
    const calm = { joy: 0, calm: 0.2, curiosity: 0, loneliness: 0, frustration: 0, pride: 0, boredom: 0, worry: 0 };
    // Standing in a trading room places no trade, and the room does not say it does.
    expect(activityFor("solana-saloon", calm)).toEqual({ action: "watch-prices", label: "watching prices at the saloon" });
    expect(activityFor("trading-floor", calm)).toEqual({ action: "watch-screens", label: "watching the tape" });
    expect(actsAt("solana-saloon")).toEqual(["read-tape", "watch-prices"]);
    for (const place of PLACE_IDS) {
      expect(`${activityFor(place, calm).label} ${actsAt(place).join(" ")}`).not.toMatch(/paper/i);
    }
  });

  it("closes out anything left over from paper trading when the books are opened", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "zoora-live-only-"));
    const file = path.join(dir, "books.sqlite");
    try {
      const before = openDatabase(file);
      const coin = before.prepare("INSERT INTO trade_orders(id, mode, mint, symbol, usd_cents, limit_usd, stop_usd, target_usd, status, thesis, created_at, expires_at) VALUES(?, ?, ?, ?, 300, '150', '135', '180', ?, 'left over', 1, 2)");
      coin.run("ord-paper-open", "paper", mint, "SOL", "open");
      coin.run("ord-paper-rest", "paper", other, "BONK", "resting");
      coin.run("ord-paper-done", "paper", other, "BONK", "closed");
      coin.run("ord-real", "live", mint, "SOL", "resting");
      const fx = before.prepare("INSERT INTO fx_orders(id, mode, pair, side, centi_lots, risk_cents, limit_px, stop_px, target_px, status, thesis, created_at, expires_at, seen_at) VALUES(?, ?, 'AUDUSD', 'buy', 1, 300, '0.65000', '0.64700', '0.65600', ?, 'left over', ?, 2, 1)");
      fx.run("fx-00000001", "paper", "resting", 1);
      fx.run("fx-00000002", "paper", "open", 2);
      fx.run("fx-00000003", "live", "resting", 3);
      fx.run("fx-00000004", "demo", "open", 4);
      before.prepare("INSERT INTO paper_trades(id, mode, mint, symbol, side, usd_cents, sol_micro, price_usd, price_sol, quoted_at, status, thesis, exit_plan, result, signature, created_at) VALUES('tr-paper', 'paper', ?, 'SOL', 'buy', 300, 1, '150', '1', 1, 'open', 'left over', 'left over', NULL, NULL, 1)").run(mint);
      // The ladder keeps a step's words once the step is reached. The old words for this one promised paper trading.
      ensureEconomy(before);
      const step = before.prepare("INSERT INTO econ_milestones(threshold_cents, reached_at, measure_cents, status, decided_at, unlock) VALUES(?, 1, ?, 'reached', NULL, ?)");
      step.run(250_000, 250_000, "A third way to earn. Trading opens on paper only.");
      step.run(500_000, 500_000, "Words the owner wrote himself when he approved it.");
      before.close();
      const db = openDatabase(file);
      expect(db.prepare("SELECT unlock FROM econ_milestones ORDER BY threshold_cents").all()).toEqual([{ unlock: "A third way to earn. A larger venture budget." }, { unlock: "Words the owner wrote himself when he approved it." }]);
      expect(LADDER[2_500]).toBe("A third way to earn. A larger venture budget.");
      const status = (table: string, id: string) => (db.prepare(`SELECT status FROM ${table} WHERE id = ?`).get(id) as { status: string }).status;
      expect(["ord-paper-open", "ord-paper-rest", "ord-paper-done", "ord-real"].map((id) => status("trade_orders", id))).toEqual(["cancelled", "cancelled", "closed", "resting"]);
      expect(["fx-00000001", "fx-00000002", "fx-00000003", "fx-00000004"].map((id) => status("fx_orders", id))).toEqual(["cancelled", "cancelled", "resting", "open"]);
      expect(status("paper_trades", "tr-paper")).toBe("closed");
      // What is left in her hands is only what is real.
      expect(activeOrders(db).map((order) => order.id)).toEqual(["ord-real"]);
      expect(activeFxOrders(db).map((order) => order.id)).toEqual(["fx-00000003", "fx-00000004"]);
      expect(recentFxOrders(db).map((order) => order.id)).toEqual(["fx-00000004", "fx-00000003"]);
      expect(tape(db, live)).toMatchObject({ positions: [], history: [], pnl: { usdCents: 0, solMicro: 0 } });
      expect(latestThesis(db)).toBeNull();
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("her trading rules", () => {
  const order = (over: Partial<TradeOrder> = {}): TradeOrder => ({ mint, symbol: "SOL", limitUsd: "150", stopUsd: "135", targetUsd: "180", thesis: "volume has built for three days above a level it held twice", influencedByVisitor: false, influencedByWeb: false, influencedByTelegram: false, ...over });
  const at = (priceUsd: string) => quote(priceUsd, String(Number(priceUsd) / 150));
  const board = (db: ReturnType<typeof openDatabase>) => activeOrders(db).map((item) => [item.symbol, item.status]);

  it("needs nothing set but the signer: a trade is three dollars, at her limit, with a stop and a target", async () => {
    const db = funded();
    const { sent, ask } = signer();
    expect(TRADE_RULES.stakeCents).toBe(300);
    expect([stakeCents({}), stakeCents({ LUMEN_TRADE_USD: "5" }), stakeCents({ LUMEN_TRADE_USD: "lots" })]).toEqual([300, 500, 300]);
    // With no signer the order is not placed, and no row is kept for it.
    expect(await placeOrder(db, {}, order(), at("148"), now, ask)).toEqual({ ok: false, reason: "NO_SIGNER" });
    expect(db.prepare("SELECT COUNT(*) AS n FROM trade_orders").get()).toEqual({ n: 0 });
    expect(sent).toEqual([]);
    // The price is already under her limit, so it is filled now, at the price it is and not at her limit.
    const placed = await placeOrder(db, live, order(), at("148"), now, ask);
    expect(placed).toMatchObject({ ok: true, mode: "live", status: "open" });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ instruction: "swap", side: "buy", mint, usdCents: 300, limitUsd: "150" });
    expect(getOrder(db, (placed as { id: string }).id)).toMatchObject({ mode: "live", usdCents: 300, limitUsd: "150", stopUsd: "135", targetUsd: "180", fillUsd: "148", status: "open" });
    expect(tape(db, live).positions).toEqual([{ symbol: "SOL", usdCents: 300, solMicro: expect.any(Number) }]);
    expect(tape(db, live).history[0]).toMatchObject({ side: "buy", exitPlan: "Stop at 135. Target at 180. Both were set before I entered." });
    // The size is not hers to send: with nothing set, the gate takes no trade over three dollars.
    expect(evaluateTrade(proposal({ usdCents: 301 }), live, db, "ok")).toEqual({ ok: false, reason: "CAP" });
    expect(evaluateTrade(proposal({ usdCents: 300 }), live, db, "ok")).toEqual({ ok: true, mode: "live" });
  });

  it("refuses an order without proper levels or without her reasons, and a second one in the same coin", async () => {
    const db = funded();
    const { sent, ask } = signer();
    for (const bad of [{ stopUsd: "150" }, { stopUsd: "160" }, { targetUsd: "150" }, { targetUsd: "140" }, { stopUsd: "0" }, { limitUsd: "-1" }, { limitUsd: "1e3" }, { stopUsd: "" }, { targetUsd: "soon" }]) expect(await placeOrder(db, live, order(bad), at("148"), now, ask)).toEqual({ ok: false, reason: "LEVELS" });
    expect(await placeOrder(db, live, order({ thesis: "vibes" }), at("148"), now, ask)).toEqual({ ok: false, reason: "NO_THESIS" });
    expect(await placeOrder(db, live, order({ influencedByWeb: true }), at("148"), now, ask)).toEqual({ ok: false, reason: "INFLUENCE" });
    expect(await placeOrder(db, { ...live, LUMEN_KILL_SWITCH: "true" }, order(), at("148"), now, ask)).toEqual({ ok: false, reason: "KILL_SWITCH" });
    expect(await placeOrder(db, live, order(), parseDexQuote({ pairs: [{ priceUsd: "148", priceNative: "1", liquidity: { usd: 100 }, baseToken: { address: mint, symbol: "SOL" } }] }, mint, now)!, now, ask)).toEqual({ ok: false, reason: "RUG" });
    expect(activeOrders(db)).toEqual([]);
    expect(sent).toEqual([]);
    expect((await placeOrder(db, live, order(), at("160"), now, ask)).ok).toBe(true);
    expect(await placeOrder(db, live, order(), at("160"), now + 1, ask)).toEqual({ ok: false, reason: "ALREADY" });
    // An order that is waiting has cost nothing yet: the signer has not been asked.
    expect(sent).toEqual([]);
  });

  it("waits for her price, and is cancelled if it does not come in a day", async () => {
    const db = funded();
    const { sent, ask } = signer();
    const placed = (await placeOrder(db, live, order(), at("160"), now, ask)) as { id: string };
    expect(getOrder(db, placed.id)).toMatchObject({ status: "resting", fillUsd: null, expiresAt: now + TRADE_RULES.restMs });
    expect(tape(db, live).positions).toEqual([]);
    // Above her limit nothing happens. With no quote nothing happens.
    expect(await tradeTick(db, live, () => at("151"), now + 60_000, ask)).toEqual({ filled: 0, stopped: 0, taken: 0, expired: 0 });
    expect(await tradeTick(db, live, () => null, now + 120_000, ask)).toEqual({ filled: 0, stopped: 0, taken: 0, expired: 0 });
    expect(sent).toEqual([]);
    // The price falls through her limit between two looks. She is filled at her limit, not at the lower price she would not have got.
    expect(await tradeTick(db, live, () => at("146"), now + 180_000, ask)).toMatchObject({ filled: 1 });
    expect(getOrder(db, placed.id)).toMatchObject({ status: "open", fillUsd: "150" });
    expect(sent).toHaveLength(1);
    // Another order never sees its price, and a day later it is gone. The signer was never asked about it.
    const late = (await placeOrder(db, live, order({ mint: other, limitUsd: "1", stopUsd: "0.9", targetUsd: "1.5" }), { ...at("2"), symbol: "BONK" }, now, ask)) as { id: string };
    expect(await tradeTick(db, live, () => at("152"), now + TRADE_RULES.restMs, ask)).toMatchObject({ expired: 1, filled: 0 });
    expect(getOrder(db, late.id)).toMatchObject({ status: "cancelled", fillUsd: null });
    expect(board(db)).toEqual([["SOL", "open"]]);
    expect(sent).toHaveLength(1);
    // If the signer is taken away, an order that is waiting stays waiting. It is not filled on paper instead.
    const third = (await placeOrder(db, live, order({ mint: other, limitUsd: "150", stopUsd: "135", targetUsd: "180" }), { ...at("160"), symbol: "BONK" }, now + TRADE_RULES.restMs, ask)) as { id: string };
    expect(await tradeTick(db, {}, (asked) => (asked === other ? at("149") : null), now + TRADE_RULES.restMs + 60_000, ask)).toMatchObject({ filled: 0 });
    expect(getOrder(db, third.id)).toMatchObject({ status: "resting", fillUsd: null });
    expect(sent).toHaveLength(1);
  });

  it("sells at the stop with no say from her, at whatever the price is by then", async () => {
    const db = funded();
    const { sent, ask } = signer();
    const placed = (await placeOrder(db, live, order(), at("150"), now, ask)) as { id: string };
    // Between the stop and the target nothing is done.
    expect(await tradeTick(db, live, () => at("136"), now + 60_000, ask)).toEqual({ filled: 0, stopped: 0, taken: 0, expired: 0 });
    // The price drops straight past the stop at 135 to 120. It is sold at 120: three dollars became two dollars forty.
    expect(await tradeTick(db, live, () => at("120"), now + 120_000, ask)).toMatchObject({ stopped: 1, taken: 0 });
    expect(sent[1]).toMatchObject({ side: "sell", reason: "stop", maxSlippageBps: TRADE_RULES.stopSlippageBps });
    expect(getOrder(db, placed.id)).toMatchObject({ status: "closed", exitWhy: "stop", exitUsd: "120", resultCents: -60 });
    expect(tape(db, live).pnl.usdCents).toBe(-60);
    expect(tape(db, live).positions).toEqual([]);
    // There is nothing in the book that moves a stop or a target once a trade is on.
    expect(activeOrders(db)).toEqual([]);
  });

  it("sends nothing to an address that is not the https signer, even to act on a stop", async () => {
    const db = funded();
    const { sent, ask } = signer();
    const placed = (await placeOrder(db, live, order(), at("150"), now, ask)) as { id: string };
    expect(sent).toHaveLength(1);
    // The signer's address is changed to one that is not https, or its secret to one too short. A stop is not sent in the clear, or signed with a secret that means nothing.
    for (const broken of [{ ...live, LUMEN_TRADE_SIGNER_URL: "http://signer.example/trade" }, { ...live, LUMEN_TRADE_SIGNER_SECRET: "short" }, {}]) {
      expect(await tradeTick(db, broken, () => at("120"), now + 60_000, ask)).toMatchObject({ stopped: 0 });
      expect(sent).toHaveLength(1);
      expect(getOrder(db, placed.id)!.status).toBe("open");
      // A trade is past its stop and could not be sold, so her trading waits for the owner.
      expect(flag(db, "trading_unknown")).toBe("1");
      setFlag(db, "trading_unknown", "0");
    }
    // With the signer back, the stop is acted on at the next look.
    expect(await tradeTick(db, live, () => at("120"), now + 120_000, ask)).toMatchObject({ stopped: 1 });
    expect(sent[1]).toMatchObject({ side: "sell", reason: "stop" });
  });

  it("sells at the target, at the target", async () => {
    const db = funded();
    const { sent, ask } = signer();
    const placed = (await placeOrder(db, live, order(), at("150"), now, ask)) as { id: string };
    // The price jumps past the target at 180 to 200. A limit sale is filled at its limit: three dollars became three sixty.
    expect(await tradeTick(db, live, () => at("200"), now + 60_000, ask)).toMatchObject({ taken: 1, stopped: 0 });
    expect(sent[1]).toMatchObject({ side: "sell", reason: "target", minUsd: "180" });
    expect(getOrder(db, placed.id)).toMatchObject({ status: "closed", exitWhy: "target", exitUsd: "180", resultCents: 60 });
    expect(tape(db, live).pnl.usdCents).toBe(60);
    // A new order in the same coin can be placed once the last one is closed.
    expect((await placeOrder(db, live, order(), at("150"), now + 120_000, ask)).ok).toBe(true);
  });

  it("does nothing at all while the kill switch is on", async () => {
    const db = funded();
    const { sent, ask } = signer();
    const placed = (await placeOrder(db, live, order(), at("150"), now, ask)) as { id: string };
    setFlag(db, "trading_kill", "1");
    expect(await tradeTick(db, live, () => at("100"), now + 60_000, ask)).toEqual({ filled: 0, stopped: 0, taken: 0, expired: 0 });
    expect(getOrder(db, placed.id)!.status).toBe("open");
    expect(sent).toHaveLength(1);
    setFlag(db, "trading_kill", "0");
    expect(await tradeTick(db, live, () => at("100"), now + 120_000, ask)).toMatchObject({ stopped: 1 });
  });

  it("never treats a row marked paper as an order of hers", async () => {
    // Five dollars is room for one three-dollar trade. A paper row must not use any of it.
    const db = funded(500);
    const { sent, ask } = signer();
    // However such a row came to be in her books, it is not hers to fill, to sell or to count.
    db.prepare("INSERT INTO trade_orders(id, mode, mint, symbol, usd_cents, limit_usd, stop_usd, target_usd, status, fill_usd, thesis, created_at, expires_at) VALUES('ord-paper', 'paper', ?, 'SOL', 300, '150', '135', '180', 'open', '150', 'left over', ?, ?)").run(mint, now, now + TRADE_RULES.restMs);
    db.prepare("INSERT INTO paper_trades(id, mode, mint, symbol, side, usd_cents, sol_micro, price_usd, price_sol, quoted_at, status, thesis, exit_plan, result, signature, created_at) VALUES('tr-paper', 'paper', ?, 'SOL', 'buy', 300, 1, '150', '1', ?, 'open', 'left over', 'left over', NULL, NULL, ?)").run(mint, now, now);
    // This one is a loss, dated today by the clock on the wall, which is the day a daily loss limit counts.
    db.prepare("INSERT INTO paper_trades(id, mode, mint, symbol, side, usd_cents, sol_micro, price_usd, price_sol, quoted_at, status, thesis, exit_plan, result, signature, created_at) VALUES('tr-paper-lost', 'paper', ?, 'SOL', 'sell', 300, 1, '150', '1', ?, 'closed', 'left over', 'left over', '{\"usdCents\":-9900,\"solMicro\":5}', NULL, ?)").run(mint, now, Date.now());
    expect(activeOrders(db)).toEqual([]);
    expect(tape(db, live)).toMatchObject({ positions: [], history: [], pnl: { usdCents: 0, solMicro: 0 } });
    expect(latestThesis(db)).toBeNull();
    // The price is far under its stop. Nothing is sold, because there is nothing real to sell.
    expect(await tradeTick(db, live, () => at("100"), now + 60_000, ask)).toEqual({ filled: 0, stopped: 0, taken: 0, expired: 0 });
    expect(sent).toEqual([]);
    expect((db.prepare("SELECT status FROM trade_orders WHERE id = 'ord-paper'").get() as { status: string }).status).toBe("open");
    // It does not stand in the way of a real order in the same coin, it is not money out, and its loss is not a loss of hers today.
    const real = await placeOrder(db, { ...live, LUMEN_TRADE_DAILY_LOSS_USD: "5" }, order(), at("160"), now, ask);
    expect(real).toMatchObject({ ok: true, mode: "live", status: "resting" });
    expect(activeOrders(db).map((item) => [item.id, item.mode])).toEqual([[(real as { id: string }).id, "live"]]);
  });

  it("reads a quote only for coins she has an order in", async () => {
    const db = funded();
    const quotes: string[] = [];
    const signed: string[] = [];
    // One way out of the engine serves both: the price feed and the signer.
    const net = (async (url: string | URL | Request) => {
      if (String(url) === signerUrl) {
        signed.push(String(url));
        return Response.json({ signature: "sig-watch" });
      }
      quotes.push(String(url));
      return Response.json({ pairs: [{ priceUsd: "149", priceNative: "1", liquidity: { usd: 50_000 }, baseToken: { address: mint, symbol: "SOL" } }] });
    }) as typeof fetch;
    expect(await watchOrders(db, live, now, net)).toEqual({ filled: 0, stopped: 0, taken: 0, expired: 0 });
    expect(quotes).toEqual([]);
    await placeOrder(db, live, order(), at("160"), now, net);
    expect(signed).toEqual([]);
    expect(await watchOrders(db, live, now + 60_000, net)).toMatchObject({ filled: 1 });
    expect(quotes).toEqual([`https://api.dexscreener.com/latest/dex/tokens/${mint}`]);
    expect(signed).toEqual([signerUrl]);
  });

  it("her money is her limit, and the signer is told her limit, her target and that a stop is a stop", async () => {
    const db = openDatabase();
    const { sent, ask } = signer();
    // With no money in a trading venue she cannot trade at all.
    expect(await placeOrder(db, live, order(), at("150"), now, ask)).toEqual({ ok: false, reason: "LADDER_CAP" });
    addVenue(db, { id: "float", bookId: "company", name: "Trading float", kind: "exchange" }, Date.now());
    // Five dollars is room for one three-dollar trade, and not for two.
    recordReading(db, { venueId: "float", valueCents: 500, source: "owner" }, Date.now());
    const first = (await placeOrder(db, live, order(), at("160"), now, ask)) as { id: string };
    expect(getOrder(db, first.id)).toMatchObject({ mode: "live", status: "resting" });
    expect(await placeOrder(db, live, order({ mint: other }), { ...at("160"), symbol: "BONK" }, now, ask)).toEqual({ ok: false, reason: "BALANCE" });
    expect(sent).toEqual([]);
    // Her price comes. The signer is asked to buy three dollars' worth for no more than her limit.
    expect(await tradeTick(db, live, () => at("149"), now + 60_000, ask)).toMatchObject({ filled: 1 });
    expect(sent[0]).toMatchObject({ instruction: "swap", side: "buy", mint, usdCents: 300, limitUsd: "150" });
    // The stop: sold at once, with room to get out.
    expect(await tradeTick(db, live, () => at("130"), now + 120_000, ask)).toMatchObject({ stopped: 1 });
    expect(sent[1]).toMatchObject({ side: "sell", reason: "stop", maxSlippageBps: TRADE_RULES.stopSlippageBps });
    expect(getOrder(db, first.id)).toMatchObject({ status: "closed", exitWhy: "stop" });
    // A target is a limit sale: no less than her price.
    const second = (await placeOrder(db, live, order(), at("150"), now + 180_000, ask)) as { id: string };
    expect(await tradeTick(db, live, () => at("181"), now + 240_000, ask)).toMatchObject({ taken: 1 });
    expect(sent[3]).toMatchObject({ side: "sell", reason: "target", minUsd: "180" });
    expect(getOrder(db, second.id)).toMatchObject({ status: "closed", exitWhy: "target", resultCents: 60 });
    // If the signer's answer is unclear, the trade is left as it is and her trading waits for the owner.
    const third = (await placeOrder(db, live, order(), at("150"), now + 300_000, ask)) as { id: string };
    expect(await tradeTick(db, live, () => at("130"), now + 360_000, unclear)).toMatchObject({ stopped: 0 });
    expect(getOrder(db, third.id)!.status).toBe("open");
    expect(await tradeTick(db, live, () => at("130"), now + 420_000, ask)).toEqual({ filled: 0, stopped: 0, taken: 0, expired: 0 });
    // The owner clears the pause, and the stop is tried again.
    setFlag(db, "trading_unknown", "0");
    expect(await tradeTick(db, live, () => at("130"), now + 480_000, ask)).toMatchObject({ stopped: 1 });
    // An unclear answer to a buy is different: the order is dropped and not tried again, because a second try could buy twice.
    const fourth = (await placeOrder(db, live, order(), at("160"), now + 540_000, ask)) as { id: string };
    expect(await tradeTick(db, live, () => at("149"), now + 600_000, unclear)).toMatchObject({ filled: 0 });
    expect(getOrder(db, fourth.id)).toMatchObject({ status: "cancelled", fillUsd: null });
    setFlag(db, "trading_unknown", "0");
    expect(await tradeTick(db, live, () => at("149"), now + 660_000, ask)).toEqual({ filled: 0, stopped: 0, taken: 0, expired: 0 });
    // The same when the price is already at her limit as she places it: she is told it is not on, not that it is waiting.
    const before = sent.length;
    expect(await placeOrder(db, live, order(), at("149"), now + 720_000, unclear)).toEqual({ ok: false, reason: "UNKNOWN" });
    expect(activeOrders(db)).toEqual([]);
    expect(sent).toHaveLength(before);
    expect(await placeOrder(db, live, order(), at("149"), now + 780_000, ask)).toEqual({ ok: false, reason: "UNKNOWN" });
  });
});
