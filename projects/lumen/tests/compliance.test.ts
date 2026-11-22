import { grantLiveTrading } from "./helpers/ladder";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AI_NOTICE, aiNoticeOpen } from "../src/components/AiNotice";
import { FloorView, type FloorBoard } from "../src/components/FloorView";
import { Nav } from "../src/components/Nav";
import { SiteFooter } from "../src/components/SiteFooter";
import { openDatabase } from "../src/db/db";
import { DOWNLOAD_LICENSE, labelDownload } from "../src/shop/delivery";
import { shopCheckoutOpen } from "../src/shop/store";
import { salesMode } from "../src/money/rules";
import { proposeTrade, type TradeProposal } from "../src/trading/book";
import { floorBoard, floorOpen } from "../src/trading/floor";
import { neutralRiskFlags, publicHistory, publicQuotes, tokenOldEnough, REAL_MONEY } from "../src/trading/public";

const now = Date.UTC(2026, 10, 10, 18);
const mint = "So11111111111111111111111111111111111111112";

function proposal(over: Partial<TradeProposal> = {}): TradeProposal {
  return {
    mint,
    symbol: "SOL",
    side: "buy",
    usdCents: 500,
    thesis: "a small mark",
    exitPlan: "leave",
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
};

function board(over: Partial<FloorBoard> = {}): FloorBoard {
  return {
    forexLive: false,
    coinsLive: false,
    forex: [],
    forexPnlCents: 0,
    quotes: [{ symbol: "SOL", priceUsd: "150", priceSol: "1", quotedAt: now, pairCreatedAt: now - 48 * 60 * 60 * 1000 }],
    positions: [],
    history: [{ symbol: "SOL", side: "sell", result: "{\"usdCents\":-250}", thesis: "the quote fell", exitPlan: "leave", quotedAt: now }],
    pnl: { usdCents: -250, solMicro: -1000 },
    ...over,
  };
}

describe("pre-launch compliance", () => {
  it("shows that Zoora is an AI, and remembers a dismissal", () => {
    expect(aiNoticeOpen(null)).toBe(true);
    expect(aiNoticeOpen("1")).toBe(false);
    const footer = renderToStaticMarkup(createElement(SiteFooter));
    expect(footer).toContain(AI_NOTICE);
    expect(footer).toContain("Not financial advice.");
    expect(readFileSync(new URL("../src/components/AiNotice.tsx", import.meta.url), "utf8")).toContain("localStorage");
  });

  it("labels generated work and does not promise copyright", () => {
    expect(labelDownload("<svg></svg>")).toContain(DOWNLOAD_LICENSE);
    const declared = labelDownload(`<?xml version="1.0" encoding="UTF-8"?>\n<svg></svg>`);
    expect(declared.startsWith("<?xml")).toBe(true);
    expect(declared.indexOf("<?xml")).toBeLessThan(declared.indexOf(DOWNLOAD_LICENSE));
    expect(labelDownload("<svg></svg>")).not.toMatch(/you own|copyright is yours/i);
    const gallery = readFileSync(new URL("../src/app/gallery/page.tsx", import.meta.url), "utf8");
    const diary = readFileSync(new URL("../src/app/diary/page.tsx", import.meta.url), "utf8");
    const shop = readFileSync(new URL("../src/app/shop/page.tsx", import.meta.url), "utf8");
    expect(gallery).toContain("AI-generated");
    expect(diary).toContain("AI-generated");
    expect(shop).toContain("AI-generated");
    expect(shop).toContain("not a transfer of ownership or copyright");
  });

  it("shows only real trades on the floor, marks a practice account, and says whether she is trading", async () => {
    const db = grantLiveTrading(openDatabase());
    const signed = { ...caps, LUMEN_TRADE_SIGNER_URL: "https://signer.example/trade", LUMEN_TRADE_SIGNER_SECRET: "s".repeat(32) };
    await proposeTrade(db, signed, proposal(), {
      symbol: "SOL", priceUsd: "150", priceSol: "1", liquidityUsd: 50_000, labels: [], pairCreatedAt: now - 3 * 24 * 60 * 60 * 1000,
    }, now, async () => Response.json({ signature: "live-sig" }));
    // A row from when there was paper trading is in the table and on no page.
    db.prepare("INSERT INTO paper_trades(id, mode, mint, symbol, side, usd_cents, sol_micro, price_usd, price_sol, quoted_at, status, thesis, exit_plan, result, signature, created_at) VALUES('tr-old', 'paper', ?, 'OLDP', 'sell', 300, 1, '1', '1', ?, 'closed', 'left over', 'left over', '{\"usdCents\":9900,\"solMicro\":5}', NULL, ?)").run(mint, now, now + 5);
    const fx = db.prepare("INSERT INTO fx_orders(id, mode, pair, side, centi_lots, risk_cents, limit_px, stop_px, target_px, status, fill_px, exit_px, exit_why, result_cents, thesis, created_at, expires_at, seen_at) VALUES(?, ?, 'AUDUSD', ?, 1, 300, '0.65000', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    fx.run("fx-0000000a", "live", "buy", "0.64700", "0.65600", "closed", "0.65000", "0.65600", "target", 598, "the range held three times this week", now + 1, now + 2, now + 1);
    fx.run("fx-0000000b", "live", "sell", "0.65300", "0.64400", "closed", "0.65000", "0.65300", "stop", -305, "sellers came in at the high", now + 2, now + 3, now + 2);
    fx.run("fx-0000000c", "live", "buy", "0.64700", "0.65600", "resting", null, null, null, null, "waiting for the pullback", now + 3, now + 4, now + 3);
    fx.run("fx-0000000d", "demo", "buy", "0.64700", "0.65600", "closed", "0.65000", "0.65600", "target", 600, "a practice account order", now + 4, now + 5, now + 4);
    fx.run("fx-0000000e", "paper", "buy", "0.64700", "0.65600", "closed", "0.65000", "0.65600", "target", 7700, "left over", now + 5, now + 6, now + 5);
    const quiet = floorBoard(db, {});
    // With nothing connected the floor is closed. What she did for real is still there to be read.
    expect(quiet).toMatchObject({ forexLive: false, coinsLive: false, forexPnlCents: 293, pnl: { usdCents: 0, solMicro: 0 } });
    expect(quiet.history.map((row) => row.symbol)).toEqual(["SOL"]);
    expect(quiet.forex.map((row) => [row.mode, row.status, row.resultCents])).toEqual([["demo", "closed", 600], ["live", "resting", null], ["live", "closed", -305], ["live", "closed", 598]]);
    expect(floorOpen({})).toBe(false);
    expect(floorBoard(db, signed)).toMatchObject({ forexLive: false, coinsLive: true });
    expect(floorOpen(signed)).toBe(true);
    const bridged = { LUMEN_FX_BRIDGE_URL: "http://127.0.0.1:8765", LUMEN_FX_BRIDGE_SECRET: "b".repeat(32) };
    expect(floorBoard(db, bridged)).toMatchObject({ forexLive: true, coinsLive: false });
    expect(floorOpen(bridged)).toBe(true);
    // The old switch opens nothing.
    expect(floorOpen({ LUMEN_TRADING_LIVE: "true" })).toBe(false);
    const closed = renderToStaticMarkup(createElement(FloorView, { board: quiet, now }));
    expect(closed).toContain(">CLOSED<");
    expect(closed).toContain("Forex is not connected. Coins are not connected.");
    expect(closed).toContain("Forex P&amp;L $2.93");
    expect(closed).toContain("LIVE buy AUDUSD 0.01 lot. Limit 0.65000, stop 0.64700, target 0.65600. Closed at its target, 0.65600. $5.98.");
    expect(closed).toContain("LIVE sell AUDUSD 0.01 lot. Limit 0.65000, stop 0.65300, target 0.64400. Closed at its stop, 0.65300. -$3.05.");
    expect(closed).toContain("Waiting at the broker for its price.");
    expect(closed).toContain("DEMO buy AUDUSD");
    expect(closed).toContain("It is not real money and it is not counted.");
    expect(closed).not.toContain("left over");
    expect(closed).not.toContain("OLDP");
    expect(closed).not.toContain("$77.00");
    expect(closed).not.toContain("$99.00");
    const open = renderToStaticMarkup(createElement(FloorView, { board: floorBoard(db, { ...signed, ...bridged }), now }));
    expect(open).toContain(">LIVE<");
    expect(open).toContain("Forex is connected to the broker. Coins are connected to the signer.");
    const html = renderToStaticMarkup(createElement(FloorView, { board: board(), now }));
    expect(html).toContain("Zoora&#x27;s trading floor");
    expect(html).toContain(REAL_MONEY);
    expect(html).toContain("DexScreener");
    expect(html).toContain("is not read back yet");
    expect(html).toContain("the broker&#x27;s own figure");
    expect(html).toContain("-$2.50");
    expect(html).toContain("No forex order yet.");
    expect(html).not.toContain("DEMO");
    expect(html).not.toContain("usdCents");
    expect(html).not.toMatch(/href="https?:/);
    expect(html).not.toMatch(/scam/i);
    for (const page of [closed, open, html]) expect(page).not.toMatch(/paper|simulated/i);
    const young = now - 60 * 60 * 1000;
    expect(tokenOldEnough(young, now)).toBe(false);
    expect(publicQuotes([{ symbol: "NEW", pairCreatedAt: young }, { symbol: "OLD", pairCreatedAt: now - 48 * 60 * 60 * 1000 }], now).map((row) => row.symbol)).toEqual(["OLD"]);
    expect(publicHistory(
      [{ symbol: "NEW", result: "1" }, { symbol: "OLD", result: "-2" }],
      [{ symbol: "NEW", pairCreatedAt: young }, { symbol: "OLD", pairCreatedAt: now - 48 * 60 * 60 * 1000 }],
      now,
    )).toEqual([{ symbol: "OLD", result: "-2" }]);
    expect(neutralRiskFlags({ liquidityUnlocked: true, top10Pct: 42.2, contractMutable: true })).toEqual([
      "liquidity unlocked",
      "top-10 holders 42%",
      "contract mutable",
    ]);
    expect(neutralRiskFlags({}).join(" ")).not.toMatch(/scam/i);
  });

  it("hides the shop and the books in the nav while money is off, and checkout stays closed", () => {
    const closed = renderToStaticMarkup(createElement(Nav, { showMoney: false }));
    expect(closed).not.toContain('href="/shop"');
    expect(closed).not.toContain('href="/books"');
    expect(closed).toContain('href="/floor"');
    const open = renderToStaticMarkup(createElement(Nav, { showMoney: true }));
    expect(open).toContain('href="/shop"');
    expect(open).toContain('href="/books"');
    const db = openDatabase();
    const env = { LUMEN_PUBLIC_MODE: "true", STRIPE_SECRET_KEY: "sk_live_x", STRIPE_WEBHOOK_SECRET: "whsec", LUMEN_SALES_ENABLED: "true" };
    expect(salesMode(env, true, false)).toBe("disabled");
    expect(shopCheckoutOpen(db, env)).toBe(false);
    expect(readFileSync(new URL("../src/app/shop/page.tsx", import.meta.url), "utf8")).toContain("Checkout is closed");
    expect(readFileSync(new URL("../src/app/books/page.tsx", import.meta.url), "utf8")).toContain("Checkout is closed");
  });
});
