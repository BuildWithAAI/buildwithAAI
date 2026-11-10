import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, securityHeaders } from "../src/auth/publicMode";
import { SignupForm } from "../src/components/SignupForm";
import { SiteFooter } from "../src/components/SiteFooter";
import { publicRedirect } from "../src/middleware";
import SuccessPage from "../src/app/success/page";

const KIT = "https://app.kit.com/forms/10168331/subscriptions";

describe("zoora.ai site", () => {
  it("sends www.zoora.ai to the apex and keeps the path", () => {
    expect(publicRedirect("www.zoora.ai", "/world", "?cam=town")).toBe("https://zoora.ai/world?cam=town");
    expect(publicRedirect("www.zoora.ai", "/success.html", "")).toBe("https://zoora.ai/success");
    expect(publicRedirect("WWW.ZOORA.AI:443", "/", "")).toBe("https://zoora.ai/");
    expect(publicRedirect("zoora.ai", "/world", "")).toBeNull();
    expect(publicRedirect("localhost:3000", "/world", "")).toBeNull();
  });

  it("folds the old html addresses onto the apex and ignores forwarded host", () => {
    expect(publicRedirect("zoora.ai", "/index.html", "?x=1", "localhost:3000", "http")).toBe("https://zoora.ai/?x=1");
    expect(publicRedirect("zoora.ai", "/success.html", "", "localhost", "http")).toBe("https://zoora.ai/success");
    expect(publicRedirect("localhost", "/success.html", "?from=kit", "evil.example", "http")).toBe("https://zoora.ai/success?from=kit");
    expect(publicRedirect("www.zoora.ai", "/", "", "127.0.0.1:3000", "http")).toBe("https://zoora.ai/");
  });

  it("posts the signup straight to Kit with one email field and no secret", () => {
    const home = renderToStaticMarkup(createElement(SignupForm));
    const footer = renderToStaticMarkup(createElement(SiteFooter));
    for (const html of [home, footer]) {
      expect(html).toContain(`action="${KIT}"`);
      expect(html).toContain('method="POST"');
      expect(html).toContain('name="email_address"');
      expect(html).not.toMatch(/api[_-]?key|sk_|bearer|KIT_/i);
      expect(html.match(/<input/g)?.length).toBe(1);
    }
    expect(footer).toContain("Not financial advice.");
    expect(home).not.toContain("profit");
  });

  it("asks the visitor to confirm by email", () => {
    const html = renderToStaticMarkup(createElement(SuccessPage));
    expect(html).toContain("Check your inbox");
    expect(html).toContain("confirm");
    expect(html).toContain('href="/"');
  });

  it("allows the Kit form in the content security policy and sets the apex origin", () => {
    const csp = contentSecurityPolicy("abc123");
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(csp).toContain("form-action 'self' https://app.kit.com/forms/10168331/subscriptions");
    expect(securityHeaders().some((header) => header.key === "Content-Security-Policy")).toBe(false);
    const fly = readFileSync(new URL("../fly.toml", import.meta.url), "utf8");
    expect(fly).toContain('LUMEN_ORIGIN = "https://zoora.ai"');
    expect(fly).toContain('LUMEN_PUBLIC_MODE = "true"');
    expect(fly).not.toMatch(/LUMEN_MONEY_LIVE\s*=/);
    expect(fly).not.toMatch(/sk_live_|STRIPE_|KIT_/);
    const layout = readFileSync(new URL("../src/app/layout.tsx", import.meta.url), "utf8");
    expect(layout).toContain('metadataBase: new URL("https://zoora.ai")');
    expect(layout).toContain('canonical: "./"');
    expect(layout).not.toContain('canonical: "https://zoora.ai/"');
    expect(layout).toContain("Zoora is building tools for people and AI agents to work together.");
    expect(readFileSync(new URL("../public/favicon.svg", import.meta.url), "utf8")).toContain("<svg");
  });
});
