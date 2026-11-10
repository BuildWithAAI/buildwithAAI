import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { makeSvg } from "../src/brain/art";
import { logSecurity } from "../src/http/log";
import { middleware } from "../src/middleware";
import { artworkSvg } from "../src/shop/store";
import { notePresence, presenceLevel, resetPresence } from "../src/world/presence";
import { rollVoxelEvent } from "../src/world/happen";

describe("launch blockers", () => {
  it("sends a per-request script nonce and keeps the apex redirect off the forwarded host", () => {
    const response = middleware(new NextRequest("http://127.0.0.1:3000/", { headers: { host: "zoora.ai" } }));
    const policy = response.headers.get("content-security-policy") ?? "";
    expect(policy).toContain("'strict-dynamic'");
    expect(policy).toContain("form-action 'self' https://app.kit.com");
    expect(policy).not.toMatch(/script-src[^;]*unsafe-inline/);
    const moved = middleware(new NextRequest("http://127.0.0.1:3000/index.html?x=1", {
      headers: { host: "zoora.ai", "x-forwarded-host": "localhost:3000", "x-forwarded-proto": "http" },
    }));
    expect(moved.headers.get("location")).toBe("https://zoora.ai/?x=1");
  });

  it("logs a security event without a body or a token", () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((line) => { lines.push(String(line)); });
    logSecurity({ event: "bad_signature", status: 400, route: "/api/stripe/webhook" });
    spy.mockRestore();
    const parsed = JSON.parse(lines[0] ?? "{}") as { event: string; status: number; route: string };
    expect(parsed.event).toBe("bad_signature");
    expect(parsed.status).toBe(400);
    expect(parsed.route).toBe("/api/stripe/webhook");
    expect(lines[0]).not.toMatch(/bearer|sk_|whsec|password/i);
  });

  it("keeps outside text out of artwork and gates visitor weather on real presence", () => {
    const poison = "visitor note <script>alert(1)</script> https://web.example/x the model said buy";
    const svg = `${artworkSvg(12)}\n${makeSvg(9, "#112233")}`;
    expect(svg).not.toContain(poison);
    expect(svg).not.toContain("<script");
    expect(svg).not.toContain("https://web.example");
    expect(readFileSync(new URL("../src/app/api/delivery/[token]/route.ts", import.meta.url), "utf8")).toContain('"Content-Security-Policy": "sandbox"');
    resetPresence();
    expect(rollVoxelEvent(() => 0.05, 0)).toBeNull();
    notePresence("abcd1234", 1_000);
    expect(presenceLevel(1_000)).toBeGreaterThan(0);
    expect(rollVoxelEvent(() => 0.05, presenceLevel(1_000))).toBe("visitor");
    resetPresence();
  });
});
