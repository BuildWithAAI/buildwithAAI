import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { createSession, OWNER_COOKIE } from "../src/auth/owner";
import { DISTINCT_BEARER_LIMIT, OWNER_TOKEN_MAP_CAP, noteDistinctBearerMiss, ownerTokenKey, ownerTokenLoad, resetOwnerTokens } from "../src/auth/ownerToken";
import { POST as reportCheckoutRoute } from "../src/app/api/checkout/report/route";
import { getEngine } from "../src/server/engine";
import { notePresence, presenceCount, presenceSize, PRESENCE_PER_IP, resetPresence } from "../src/world/presence";

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

  it("rejects an owner session cookie on the public edge", async () => {
    const previous = process.env.LUMEN_PUBLIC_MODE;
    process.env.LUMEN_PUBLIC_MODE = "true";
    try {
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
  });
});
