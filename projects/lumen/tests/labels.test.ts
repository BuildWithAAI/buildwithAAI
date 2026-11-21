import { describe, expect, it } from "vitest";
import { clampLabelPoint, clipThought, labelCaption, placeThought, shortSkyLine } from "../src/world/labels";

describe("narrow island labels", () => {
  it("keeps the name and shortens the sky pill", () => {
    expect(labelCaption("Zoora", "reading the notice board", "calm", true)).toBe("Zoora");
    expect(labelCaption("Zoora", "reading", "calm", false)).toContain("reading");
    expect(shortSkyLine("5:08 PM", "new")).toBe("5:08 PM · new moon");
    expect(shortSkyLine("5:08 PM", "waxing crescent")).toBe("5:08 PM · waxing crescent");
  });

  it("clamps a label inside the screen and separates two that collide", () => {
    const clipped = clampLabelPoint(-40, 400, 390, 844, []);
    expect(clipped.x).toBeGreaterThanOrEqual(28);
    expect(clipped.y).toBeLessThan(844 - 120);
    const second = clampLabelPoint(clipped.x, clipped.y, 390, 844, [clipped]);
    expect(Math.abs(second.y - clipped.y)).toBeGreaterThan(20);
  });

  it("ends a closed thought on a word with an ellipsis", () => {
    const long = "I looked at my goal, Learn the island's places and leave a few shapes that are mine.";
    const closed = clipThought(long, false, 48);
    expect(closed.endsWith("…")).toBe(true);
    expect(closed.endsWith(" …")).toBe(false);
    expect(closed.includes("shapes that are mine")).toBe(false);
    expect(clipThought(long, true, 48)).toBe(long);
  });

  it("puts the thought above the name when there is room", () => {
    const spot = placeThought({ x: 180, y: 420 }, { x: 180, y: 390 }, 390, 844);
    expect(spot.y).toBeLessThan(390);
    expect(spot.x).toBeGreaterThan(40);
    expect(spot.x).toBeLessThan(350);
  });
});
