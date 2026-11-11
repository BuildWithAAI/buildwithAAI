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
import { proposeTrade, tape, type TradeProposal } from "../src/trading/book";
import { neutralRiskFlags, publicHistory, publicQuotes, tokenOldEnough, SIMULATED } from "../src/trading/public";

const now = Date.UTC(2026, 10, 10, 18);
const mint = "So11111111111111111111111111111111111111112";

function proposal(over: Partial<TradeProposal> = {}): TradeProposal {
  return {
    mint,
    symbol: "SOL",
    side: "buy",
    usdCents: 500,
    thesis: "a paper mark",
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
    mode: "PAPER",
    showLivePnl: false,
    quotes: [{ symbol: "SOL", priceUsd: "150", priceSol: "1", quotedAt: now, pairCreatedAt: now - 48 * 60 * 60 * 1000 }],
    positions: [],
    history: [{ symbol: "SOL", side: "sell", result: "{\"usdCents\":-250}", thesis: "the quote fell", exitPlan: "leave", quotedAt: now, mode: "paper" }],
    pnl: { paperUsdCents: -250, paperSolMicro: -1000, liveUsdCents: 900, liveSolMicro: 1 },
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

  it("keeps the public tape on paper and hides live P&L while trading is off", async () => {
    const db = openDatabase();
    await proposeTrade(db, { ...caps, LUMEN_TRADING_LIVE: "true", LUMEN_TRADE_SIGNER_URL: "https://signer.example/trade", LUMEN_TRADE_SIGNER_SECRET: "s" }, proposal(), {
      symbol: "SOL", priceUsd: "150", priceSol: "1", liquidityUsd: 50_000, labels: [], pairCreatedAt: now - 3 * 24 * 60 * 60 * 1000,
    }, now, async () => Response.json({ signature: "live-sig" }));
    const quiet = tape(db, {});
    expect(quiet.mode).toBe("PAPER");
    expect(quiet.showLivePnl).toBe(false);
    expect(quiet.history.some((row) => row.mode === "live")).toBe(true);
    const live = tape(db, { LUMEN_TRADING_LIVE: "true" });
    expect(live.mode).toBe("LIVE");
    expect(live.showLivePnl).toBe(true);
    const html = renderToStaticMarkup(createElement(FloorView, { board: board(), now }));
    expect(html).toContain("paper trading floor");
    expect(html).toContain(SIMULATED);
    expect(html).toContain("DexScreener");
    expect(html).toContain("does not subtract slippage or a fee");
    expect(html).toContain("-$2.50");
    expect(html).not.toContain("usdCents");
    expect(html).not.toContain("Live P&amp;L");
    expect(html).not.toMatch(/href="https?:/);
    expect(html).not.toMatch(/scam/i);
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
