import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/db";
import { setFlag } from "../src/db/db";
import { composeThought } from "../src/integrations/telegramOwner";
import { PLACE_IDS } from "../src/world/places";
import { evaluateTrade, judgeQuote, parseDexQuote, proposeTrade, tape, type TradeProposal } from "../src/trading/book";

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
    const db = openDatabase();
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
