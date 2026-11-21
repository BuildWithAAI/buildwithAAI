import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { genomeFromSoul } from "../src/form/genome";
import { drawPortrait } from "../src/form/portrait";
import { currentStyle, glowColor, landStyles } from "../src/form/self";
import { cssVariables, feelingColor, houseStyle, hslHex, REGION_LIMITS, regionStyle } from "../src/form/style";
import { artworkSvg } from "../src/shop/store";
import { AREA_IDS } from "../src/world/areas";

const SEA = "I am a quiet thing of the tide. The sea is deep and the water is slow. I make and paint and glow.";
const SPARK = "I glow. I shine bright like a lantern. I play and laugh, a delight, and I care for my keeper and friend.";

function hueOf(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

function apart(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

describe("the one style", () => {
  it("comes from her soul: a different soul is a different style", () => {
    const sea = houseStyle(genomeFromSoul(SEA));
    const spark = houseStyle(genomeFromSoul(SPARK));
    expect(sea.palette).not.toEqual(spark.palette);
    expect(houseStyle(genomeFromSoul(SEA))).toEqual(sea);
    for (const color of Object.values(sea.palette)) expect(color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("every part of her land is the house style turned a little, within fixed bounds", () => {
    const genome = genomeFromSoul(SEA);
    const house = houseStyle(genome);
    const seen = new Set<string>();
    for (const id of AREA_IDS) {
      const region = regionStyle(genome, id);
      expect(apart(region.hue, house.hue)).toBeLessThanOrEqual(REGION_LIMITS.hue);
      expect(Math.abs(region.saturation - house.saturation)).toBeLessThanOrEqual(REGION_LIMITS.saturation + 1e-9);
      // What makes it one place is identical everywhere.
      expect(region.palette.accent).toBe(house.palette.accent);
      expect(region.palette.ink).toBe(house.palette.ink);
      expect(region.palette.dim).toBe(house.palette.dim);
      expect(region.marking).toBe(house.marking);
      expect(region.line).toBe(house.line);
      expect(regionStyle(genome, id)).toEqual(region);
      seen.add(region.palette.body);
    }
    // And the places do differ from one another.
    expect(seen.size).toBeGreaterThan(AREA_IDS.length / 2);
    expect(landStyles(() => SEA)).toHaveLength(AREA_IDS.length);
  });

  it("her feelings are shades of her own colours", () => {
    const style = houseStyle(genomeFromSoul(SEA));
    expect(apart(hueOf(feelingColor(style, "calm")), style.hue)).toBeLessThan(3);
    expect(apart(hueOf(feelingColor(style, "joy")), style.accentHue)).toBeLessThan(3);
    for (const feeling of ["calm", "curiosity", "loneliness", "worry", "joy", "pride", "frustration", "boredom", "unknown"]) expect(feelingColor(style, feeling)).toMatch(/^#[0-9a-f]{6}$/);
    expect(glowColor("calm", () => SEA)).toBe(feelingColor(style, "calm"));
  });

  it("the portrait, the shop art and the site all draw from it", () => {
    const genome = genomeFromSoul(SEA);
    const style = houseStyle(genome);
    const svg = artworkSvg(200, style);
    expect(svg).toContain(style.palette.deep);
    expect(svg).toContain(style.palette.accent);
    const mark = /<circle cx="40"[^>]*fill="(#[0-9a-f]{6})"/.exec(svg)?.[1] ?? "";
    expect(apart(hueOf(mark), style.hue)).toBeLessThanOrEqual(REGION_LIMITS.hue + 1);
    const vars = cssVariables(style);
    expect(vars["--bg"]).toBe(style.palette.deep);
    expect(vars["--ink"]).toBe(style.palette.ink);
    // The portrait can be drawn in a region's style and stays the same shape.
    const house = drawPortrait(genome, { width: 80, background: "clear" });
    const region = drawPortrait(genome, { width: 80, background: "clear" }, regionStyle(genome, "beach-dock"));
    let sameShape = true;
    for (let y = 0; y < house.height; y += 1) for (let x = 0; x < house.width; x += 1) if (Math.abs(house.alphaAt(x, y) - region.alphaAt(x, y)) > 1e-6) sameShape = false;
    expect(sameShape).toBe(true);
    expect(Buffer.from(house.data.buffer).equals(Buffer.from(region.data.buffer))).toBe(false);
  });

  it("still has a style when the soul file cannot be read", () => {
    const style = currentStyle(() => {
      throw new Error("missing");
    });
    expect(style.palette.body).toMatch(/^#[0-9a-f]{6}$/);
    expect(hslHex(0, 1, 0.5)).toBe("#ff0000");
  });
});

/**
 * The lock. New code may not bring its own colours. The files below still hold colours from before the
 * style existed; each may keep at most what it has today, and that number should only go down. Any
 * other file with a colour written into it fails here.
 */
const LEGACY: Record<string, number> = {
  "src/components/WorldView.tsx": 20,
  "src/components/islandAreas.ts": 11,
  "src/world/registry.ts": 7,
  "src/brain/emotions.ts": 8,
  "src/world/chunkMath.ts": 6,
  "src/world/visitors.ts": 5,
  "src/components/Scene.tsx": 4,
  "src/brain/art.ts": 2,
  "src/components/chunkLayer.ts": 1,
  "src/brain/tick.ts": 1,
};

describe("the style lock", () => {
  it("no file outside the style brings its own colours", () => {
    const found: Record<string, number> = {};
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(name)) {
          const count = (readFileSync(full, "utf8").match(/#[0-9a-fA-F]{6}\b/g) ?? []).length;
          if (count) found[full.split(path.sep).join("/")] = count;
        }
      }
    };
    walk("src");
    const over = Object.entries(found).filter(([file, count]) => count > (LEGACY[file] ?? 0)).map(([file, count]) => `${file}: ${count} (allowed ${LEGACY[file] ?? 0})`);
    expect(over).toEqual([]);
  });
});
