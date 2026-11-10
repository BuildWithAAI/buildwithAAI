import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { clientAddress } from "../src/auth/owner";
import { allowPage, limitedPage, resetPageLimits } from "../src/auth/pageLimit";
import { allowPublicRequest, PUBLIC_RATE_LIMIT } from "../src/auth/public";
import { loginReachable, ownerRouteOpen, publicModeOn, securityHeaders } from "../src/auth/publicMode";
import { parseBuildLog } from "../src/build/log";
import { BuildView } from "../src/components/BuildView";
import { openDatabase } from "../src/db/db";
import { spendAllowed } from "../src/money/rules";

const log = `---
sha: abc1234
title: Open the build page.
summary: Visitors can watch what shipped.
date: 2026-11-10T18:00:00Z
image:
`;

describe("public mode", () => {
  it("blocks owner routes without a session and leaves the island open", () => {
    const env = { LUMEN_PUBLIC_MODE: "true" };
    expect(publicModeOn({ LUMEN_PUBLIC_MODE: "TRUE" })).toBe(true);
    expect(publicModeOn({ LUMEN_PUBLIC_MODE: " True " })).toBe(true);
    expect(publicModeOn({ LUMEN_PUBLIC_MODE: "false" })).toBe(false);
    expect(ownerRouteOpen("/admin", false, env)).toBe(false);
    expect(ownerRouteOpen("/admin/ledger", false, env)).toBe(false);
    expect(ownerRouteOpen("/admin?tab=desk", false, env)).toBe(false);
    expect(ownerRouteOpen("/admin", true, env)).toBe(true);
    expect(ownerRouteOpen("/admin/login", false, env)).toBe(false);
    expect(loginReachable("203.0.113.8", env)).toBe(false);
    expect(loginReachable(null, env)).toBe(true);
    expect(loginReachable("   ", env)).toBe(true);
    expect(loginReachable("203.0.113.8", {})).toBe(true);
    expect(ownerRouteOpen("/world", false, env)).toBe(true);
    expect(ownerRouteOpen("/build", false, env)).toBe(true);
    expect(ownerRouteOpen("/admin", false, {})).toBe(true);
    expect(spendAllowed({ LUMEN_PUBLIC_MODE: "true", LUMEN_SPEND_ENABLED: "true", LUMEN_CARD_ISSUER: "owner_checkout" }, true, false, true).open).toBe(false);
    expect(spendAllowed({ LUMEN_PUBLIC_MODE: "true" }, true, false, true).open).toBe(false);
    expect(securityHeaders(true).some((header) => header.key === "Content-Security-Policy")).toBe(true);
    expect(securityHeaders(false).some((header) => header.key === "Strict-Transport-Security")).toBe(true);
    expect(securityHeaders().some((header) => header.key === "Content-Security-Policy")).toBe(true);
  });

  it("trusts Cloudflare Tunnel and ngrok, and rate-limits the public", () => {
    const cf = (name: string) => (name === "cf-connecting-ip" ? "203.0.113.9" : name === "x-forwarded-for" ? "1.1.1.1" : null);
    expect(clientAddress(cf, "cloudflare")).toBe("203.0.113.9");
    expect(clientAddress(cf, undefined, true)).toBe("203.0.113.9");
    const ngrok = (name: string) => (name === "x-forwarded-for" ? "198.51.100.20, 10.0.0.1" : null);
    expect(clientAddress(ngrok, "ngrok")).toBe("198.51.100.20");
    const db = openDatabase();
    const now = Date.UTC(2026, 10, 10, 18);
    for (let i = 0; i < PUBLIC_RATE_LIMIT; i += 1) expect(allowPublicRequest(db, "203.0.113.9", now + i)).toBe(true);
    expect(allowPublicRequest(db, "203.0.113.9", now + PUBLIC_RATE_LIMIT)).toBe(false);
    resetPageLimits();
    for (let i = 0; i < 120; i += 1) expect(allowPage("203.0.113.9", now)).toBe(true);
    expect(allowPage("203.0.113.9", now)).toBe(false);
    expect(limitedPage().status).toBe(429);
  });

  it("renders the build timeline", () => {
    const entries = parseBuildLog(log);
    expect(entries).toHaveLength(1);
    const html = renderToStaticMarkup(createElement(BuildView, {
      entries,
      place: "research-station",
      feeling: "I feel curious.",
      activity: "researching an idea",
    }));
    expect(html).toContain("Watch the build");
    expect(html).toContain("abc1234");
    expect(html).toContain("Open the build page.");
    expect(html).toContain("research-station");
    expect(html).toContain("researching an idea");
    expect(html).toContain("/world");
    expect(html).toContain("Chicago");
  });

  it("runs the image as node, with a health check", () => {
    const docker = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
    const entry = readFileSync(new URL("../docker-entrypoint.sh", import.meta.url), "utf8");
    const fly = readFileSync(new URL("../fly.toml", import.meta.url), "utf8");
    expect(readFileSync(new URL("../next.config.ts", import.meta.url), "utf8")).toContain('output: "standalone"');
    expect(docker).toContain('CMD ["node", "server.js"]');
    expect(docker).toContain("HEALTHCHECK");
    expect(docker).toContain("/healthz");
    expect(entry).toContain("gosu node");
    expect(fly).toContain("[[http_service.checks]]");
    expect(fly).toContain("path = \"/api/health\"");
    expect(fly).toContain("LUMEN_TRUSTED_PROXY = \"fly\"");
    expect(fly).toContain("snapshot_retention = 5");
    expect(fly).toContain("scheduled_snapshots = true");
  });

  it("keeps the build log in the image context", () => {
    const ignore = readFileSync(new URL("../.dockerignore", import.meta.url), "utf8");
    expect(ignore).toContain(".env.*");
    expect(ignore).toContain("!docs/BUILD_LOG.md");
    expect(ignore.split("\n").includes("docs")).toBe(false);
    const text = readFileSync(new URL("../docs/BUILD_LOG.md", import.meta.url), "utf8");
    expect(parseBuildLog(text).length).toBeGreaterThan(0);
  });
});
