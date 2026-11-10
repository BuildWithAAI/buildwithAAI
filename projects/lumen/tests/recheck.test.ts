import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createSession, OWNER_COOKIE, ownerCookie, ownerCookieSecure } from "../src/auth/owner";
import { DISTINCT_BEARER_LIMIT, OWNER_TOKEN_MAP_CAP, noteDistinctBearerMiss, ownerTokenKey, ownerTokenLoad, resetOwnerTokens } from "../src/auth/ownerToken";
import { POST as reportCheckoutRoute } from "../src/app/api/checkout/report/route";
import { getEngine } from "../src/server/engine";
import { notePresence, presenceCount, presenceSize, PRESENCE_GLOBAL_CAP, PRESENCE_PER_48, PRESENCE_PER_IP, resetPresence } from "../src/world/presence";
import { allowGuestNote, openDatabase } from "../src/db/db";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FloorView } from "../src/components/FloorView";

const isolated = path.join(mkdtempSync(path.join(tmpdir(), "lumen-recheck-")), "lumen.sqlite");
process.env.LUMEN_DATA = isolated;

describe("security recheck", () => {
  it("starts the desk proxy and answers on ipv6 localhost", async () => {
    const upstream = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("desk-ok");
    });
    await new Promise<void>((resolve) => upstream.listen(3410, "127.0.0.1", () => resolve()));
    const child = spawn(process.execPath, ["desk-proxy.mjs"], {
      cwd: new URL("..", import.meta.url),
      env: { ...process.env, LUMEN_DESK_SECRET: "desk-secret", PORT: "3410", LUMEN_DESK_PORT: "3411" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let body = "";
    try {
      for (let i = 0; i < 40; i += 1) {
        try {
          const response = await fetch("http://[::1]:3411/healthz");
          body = await response.text();
          if (body === "desk-ok") break;
        } catch { /* the proxy is still binding */ }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    } finally {
      child.kill();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
    expect(body).toBe("desk-ok");
  });

  it("keeps the owner cookie strict, and omits Secure only on the loopback desk", () => {
    expect(ownerCookieSecure({ forwardedProto: null, deskHttp: true })).toBe(false);
    expect(ownerCookieSecure({ forwardedProto: "http", deskHttp: true })).toBe(false);
    expect(ownerCookieSecure({ forwardedProto: "https", deskHttp: true })).toBe(true);
    expect(ownerCookieSecure({ forwardedProto: null, deskHttp: false })).toBe(true);
    expect(ownerCookie({ forwardedProto: "https", deskHttp: false })).toMatchObject({ httpOnly: true, sameSite: "strict", secure: true, path: "/" });
  });

  it("rejects an owner session cookie on the public edge", async () => {
    const previous = process.env.LUMEN_PUBLIC_MODE;
    process.env.LUMEN_PUBLIC_MODE = "true";
    try {
      delete (globalThis as { engine?: unknown }).engine;
      const engine = getEngine();
      const token = createSession(engine.db, Date.now());
      const headers = { cookie: `${OWNER_COOKIE}=${token}`, origin: "https://zoora.ai", "content-type": "application/json" };
      const desk = await reportCheckoutRoute(new Request("https://zoora.ai/api/checkout/report", { method: "POST", headers, body: "{}" }));
      expect(desk.status).toBe(400);
      expect(await desk.json()).toMatchObject({ error: "CLAIM" });
      const edge = await reportCheckoutRoute(new Request("https://zoora.ai/api/checkout/report", {
        method: "POST",
        headers: { ...headers, "fly-client-ip": "203.0.113.9" },
        body: "{}",
      }));
      expect(edge.status).toBe(401);
      expect(await edge.json()).toEqual({ error: "UNAUTHORIZED" });
    } finally {
      if (previous === undefined) delete process.env.LUMEN_PUBLIC_MODE;
      else process.env.LUMEN_PUBLIC_MODE = previous;
    }
  });

  it("caps presence slots per address and blocked bearer buckets at 4096", () => {
    resetPresence();
    for (let i = 0; i < PRESENCE_PER_IP + 4; i += 1) notePresence(`slot${i.toString(16).padEnd(6, "a")}`, 5_000, "203.0.113.9");
    notePresence("otherslot", 5_000, "198.51.100.8");
    expect(presenceCount(5_000)).toBe(PRESENCE_PER_IP + 1);
    notePresence("laterone1", 80_000, "203.0.113.9");
    expect(presenceCount(80_000)).toBe(1);
    expect(presenceSize()).toBe(1);

    resetOwnerTokens();
    const now = 1_700_000_000_000;
    for (let i = 0; i < OWNER_TOKEN_MAP_CAP + 3; i += 1) {
      for (let key = 0; key < DISTINCT_BEARER_LIMIT; key += 1) {
        noteDistinctBearerMiss(`2001:${(i + 1).toString(16)}:1:${key.toString(16)}::1`, ownerTokenKey(`cap-${i}-${key}`), now);
      }
    }
    expect(ownerTokenLoad()).toBeLessThanOrEqual(OWNER_TOKEN_MAP_CAP);
    resetPresence();
    for (let i = 0; i < PRESENCE_PER_IP; i += 1) notePresence(`aaaaaaa${i}`, 9_000, "2001:db8:1:2::1");
    notePresence("bbbbbbb1", 9_000, "2001:db8:1:2::99");
    expect(presenceCount(9_000)).toBe(PRESENCE_PER_IP);
    for (let i = 0; i < PRESENCE_GLOBAL_CAP + 10; i += 1) notePresence(`cap${i.toString(16).padEnd(6, "b")}`, 9_000, `203.0.113.${i % 200}`);
    expect(presenceSize()).toBeLessThanOrEqual(PRESENCE_GLOBAL_CAP);
    resetPresence();
    for (let net = 0; net < 40; net += 1) notePresence(`net${net.toString(16).padEnd(6, "c")}`, 9_000, `2001:db8:1:${net.toString(16)}::1`);
    expect(presenceCount(9_000)).toBe(PRESENCE_PER_48);
    notePresence("othernet1", 9_000, "2001:db8:9:1::1");
    expect(presenceCount(9_000)).toBe(PRESENCE_PER_48 + 1);
    const book = openDatabase();
    const at = 1_800_000_000_000;
    for (let i = 0; i < 8; i += 1) expect(allowGuestNote(book, "2001:db8:9:9::1", at + i)).toBe(true);
    expect(allowGuestNote(book, "2001:db8:9:9::2", at + 9)).toBe(false);
  });

  it("formats a paper result and leaves a live row out of the paper floor", () => {
    const html = renderToStaticMarkup(createElement(FloorView, {
      now: 24 * 60 * 60 * 1000 + 100,
      board: {
        mode: "PAPER",
        showLivePnl: false,
        quotes: [
          { symbol: "LIVEX", priceUsd: "1", priceSol: "1", quotedAt: 1, pairCreatedAt: 1 },
          { symbol: "PAPER", priceUsd: "1", priceSol: "1", quotedAt: 1, pairCreatedAt: 1 },
        ],
        positions: [],
        history: [
          { symbol: "LIVEX", side: "sell", result: "{\"usdCents\":-120,\"solMicro\":-3}", thesis: "a paper note", exitPlan: "leave", quotedAt: 1, mode: "live" },
          { symbol: "PAPER", side: "sell", result: "{\"usdCents\":40,\"solMicro\":1}", thesis: "the tide", exitPlan: "hold", quotedAt: 1, mode: "paper" },
        ],
        pnl: { paperUsdCents: 40, paperSolMicro: 1, liveUsdCents: -120, liveSolMicro: -3 },
      },
    }));
    expect(html).not.toContain("PAPER sell LIVEX");
    expect(html).not.toContain("usdCents");
    expect(html).toContain("Closed $0.40");
    expect(html).toContain("SIMULATED");
  });
});
