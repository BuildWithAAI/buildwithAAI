import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Nav } from "../src/components/Nav";
import { homeGreeting, welcomeBack, worldTipOpen } from "../src/components/visit";

describe("welcome", () => {
  it("opens with a greeting and keeps the raw numbers out of the first line", () => {
    expect(homeGreeting(true, "I feel calm. The water is even.")).toBe("Hello. I feel calm. The water is even.");
    expect(homeGreeting(false, "I feel calm.")).toMatch(/^I'm resting/);
    expect(homeGreeting(true, "I feel calm.")).not.toMatch(/\d\.\d/);
  });

  it("keeps the main nav to five links and tucks the rest under More", () => {
    const html = renderToStaticMarkup(createElement(Nav, {}));
    expect(html).toContain(">World<");
    expect(html).toContain(">Gallery<");
    expect(html).toContain(">Diary<");
    expect(html).toContain(">Guestbook<");
    expect(html).toContain(">Saloon<");
    expect(html).toContain(">More<");
    expect(worldTipOpen(null)).toBe(true);
    expect(worldTipOpen("1")).toBe(false);
  });

  it("welcomes a browser that has been here before", () => {
    expect(welcomeBack(null, 10_000)).toBeNull();
    expect(welcomeBack(String(Date.now() - 3 * 86_400_000), Date.now())).toMatch(/Welcome back/);
  });
});
