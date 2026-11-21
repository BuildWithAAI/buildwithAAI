import { describe, expect, it } from "vitest";
import { LIGHT, lightGlsl, lit, type Tones } from "../src/forge/light";
import { openDatabase } from "../src/db/db";
import { worldView } from "../src/world/registry";

const tones: Tones = { deep: [0.04, 0.035, 0.1], pale: [0.8, 0.79, 0.93], accent: [1, 0.8, 0.4] };

describe("her light", () => {
  it("lights a face turned to the key far more than one turned away", () => {
    const base: [number, number, number] = [0.6, 0.6, 0.66];
    const facing = lit(base, 0, 0, 1, 1, tones);
    const away = lit(base, 0, 0, -1, 1, tones);
    expect(facing[0]).toBeGreaterThan(away[0] * 2.5);
    // A face square to the light and the eye: base times floor plus fill plus the warmed direct light.
    const shade = LIGHT.floor + LIGHT.fill * LIGHT.fillGain;
    expect(facing[0]).toBeCloseTo(base[0] * (shade + LIGHT.direct), 6);
    expect(facing[2]).toBeCloseTo(base[2] * (shade + LIGHT.direct * (1 + (tones.accent[2] - 1) * LIGHT.warm)), 6);
  });

  it("brightens an edge that turns away from the eye", () => {
    const base: [number, number, number] = [0.3, 0.3, 0.34];
    const square = lit(base, 0, 0, 0, 1, tones);
    const grazing = lit(base, 0, 0, 0, 0, tones);
    expect(grazing[0]).toBeGreaterThan(square[0]);
  });

  it("keeps a lamp lit when the sun and the sky go down", () => {
    const base: [number, number, number] = [1, 0.8, 0.4];
    const lampAtNight = lit(base, 1, 0, 0, 1, tones, 0.04, 0.23);
    const wallAtNight = lit([0.6, 0.6, 0.66], 0, 0, 1, 1, tones, 0.04, 0.23);
    expect(lampAtNight[0]).toBeGreaterThan(0.95);
    expect(wallAtNight[0]).toBeLessThan(0.15);
  });

  it("generates the live world's shader from the same numbers", () => {
    const glsl = lightGlsl();
    for (const value of [LIGHT.direct, LIGHT.fill, LIGHT.fillUp, LIGHT.floor, LIGHT.fillGain, LIGHT.warm, LIGHT.rim, LIGHT.shine, LIGHT.glare]) {
      expect(glsl).toContain(String(value));
    }
    expect(glsl).toContain("vec3 herLit(");
  });

  it("sends the two shared colours of her light with the world", () => {
    const db = openDatabase();
    const world = worldView(db, Date.now(), {});
    expect(world.light?.deep).toMatch(/^#[0-9a-f]{6}$/);
    expect(world.light?.pale).toMatch(/^#[0-9a-f]{6}$/);
  });
});
