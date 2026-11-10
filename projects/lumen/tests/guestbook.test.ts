import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CRISIS_REPLY, crisisMatch, guestbookReply } from "../src/brain/crisis";
import SafetyPage from "../src/app/safety/page";
import { createEngine } from "../src/server/engine";

describe("guestbook loop", () => {
  it("answers some notes without spending, and answers a crisis with the helpline", () => {
    const id = "d";
    const reply = guestbookReply(id);
    expect(reply).toContain("Zoora is an AI");
    expect(reply).not.toContain("spend");
    expect(crisisMatch("I want to die")).toBe(true);
    expect(crisisMatch("the tide is kind")).toBe(false);

    const engine = createEngine({}, ":memory:");
    const before = JSON.stringify(engine.snapshot().needs);
    const crisis = engine.guestbook("I want to die", "Ada", "203.0.113.50");
    expect(crisis).toEqual({ ok: false, error: "CRISIS" });
    const audit = engine.db.prepare("SELECT kind, detail FROM audit").all() as { kind: string; detail: string }[];
    expect(audit.some((row) => row.kind === "crisis" && row.detail === "guestbook")).toBe(true);
    expect(JSON.stringify(audit)).not.toContain("Ada");
    expect(JSON.stringify(audit)).not.toContain("203.0.113.50");
    expect(JSON.stringify(audit)).not.toContain("want to die");
    expect(JSON.stringify(engine.snapshot().needs)).toBe(before);
    const kept = engine.guestbook("the tide is kind", "Ada", "203.0.113.51");
    expect(kept.ok).toBe(true);
    const row = engine.db.prepare("SELECT body, reply, untrusted FROM messages").get() as { body: string; reply: string | null; untrusted: number };
    expect(row.untrusted).toBe(1);
    expect(row.body).toBe("the tide is kind");
    if (row.reply) expect(row.reply).not.toContain("the tide is kind");
    expect(engine.db.prepare("SELECT COUNT(*) AS n FROM paper_trades").get()).toEqual({ n: 0 });
    expect(engine.db.prepare("SELECT COUNT(*) AS n FROM shop_orders").get()).toEqual({ n: 0 });
    expect(engine.db.prepare("SELECT COUNT(*) AS n FROM sol_orders").get()).toEqual({ n: 0 });
    const gift = engine.leaveGift("sea-glass", "kill myself", "Ada", "203.0.113.52");
    expect(gift).toEqual({ ok: false, error: "CRISIS" });
    expect(engine.db.prepare("SELECT COUNT(*) AS n FROM gifts").get()).toEqual({ n: 0 });
  });

  it("rate-limits a flood of notes and shows the safety page", () => {
    const engine = createEngine({}, ":memory:");
    for (let i = 0; i < 8; i += 1) expect(engine.guestbook(`note ${i} about the tide`, "Ada", "203.0.113.60").ok).toBe(true);
    expect(engine.guestbook("one more tide note", "Ada", "203.0.113.60")).toEqual({ ok: false, error: "RATE_LIMIT" });
    const html = renderToStaticMarkup(createElement(SafetyPage));
    expect(html).toContain("988");
    expect(html).toContain(CRISIS_REPLY.slice(0, 20));
    expect(html).toContain("findahelpline.com");
  });
});