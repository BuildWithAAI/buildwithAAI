import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/db";
import { genomeFromSoul } from "../src/form/genome";
import { encodePng } from "../src/form/raster";
import { houseStyle } from "../src/form/style";
import { handFrom, lookFrom } from "../src/forge/hand";
import { compose, IDEA_KINDS } from "../src/forge/ideas";
import { cross, dot, encodeMesh, MATERIALS, point, soundMesh, sub, triangleCount, type Mesh } from "../src/forge/mesh";
import { buildRecipe, cleanRecipe, LIMITS } from "../src/forge/recipe";
import { groundHeight, loft, noise, profile, spin } from "../src/forge/shape";
import { considerForge, FORGE, forgeDue, getBuild, herHand, islandCell, meshBytes, pictureBytes, raise, recipeOf, remove, reshape, revOf, siteAt, standing, undo } from "../src/forge/store";
import { renderMesh } from "../src/forge/view";
import { setCreativeEnabled } from "../src/world/creative";

const SOUL = "I am a quiet thing of the tide. The sea is deep and the water is slow. I make and paint and glow, and I care for my keeper.";
const genome = genomeFromSoul(SOUL);
const hand = handFrom(genome);
const style = houseStyle(genome);
const plain = { ...hand, swell: 0 };
const T = 1_800_000_000_000;
const calm = { calm: 0.8, joy: 0.1, curiosity: 0.1, loneliness: 0, frustration: 0, pride: 0, boredom: 0, worry: 0 } as never;

/** Positive when the triangles face outward. */
function volume(mesh: Mesh): number {
  let total = 0;
  for (let i = 0; i < mesh.indices.length; i += 3) total += dot(point(mesh, mesh.indices[i]!), cross(point(mesh, mesh.indices[i + 1]!), point(mesh, mesh.indices[i + 2]!))) / 6;
  return total;
}

const tower = { name: "Test Tower", seed: 3, parts: [{ op: "loft", up: 20, from: { shape: "block", width: 6 }, bands: 4 }] };

describe("her outlines", () => {
  it("always have the asked number of points and the asked size", () => {
    const round = profile({ width: 4 }, 32);
    expect(round).toHaveLength(32);
    for (const [x, z] of round) expect(Math.hypot(x, z)).toBeCloseTo(2, 6);
    const block = profile({ shape: "block", width: 6, depth: 2, soft: 0 }, 64);
    expect(Math.max(...block.map((p) => p[0]))).toBeCloseTo(3, 6);
    expect(Math.max(...block.map((p) => p[1]))).toBeCloseTo(1, 6);
    const sided = profile({ shape: "sided", sides: 6, width: 2, soft: 0 }, 60);
    expect(Math.max(...sided.map((p) => Math.hypot(...p)))).toBeCloseTo(1, 2);
    expect(Math.min(...sided.map((p) => Math.hypot(...p)))).toBeCloseTo(Math.cos(Math.PI / 6), 3);
  });

  it("scallop by the asked number of lobes", () => {
    const edge = profile({ width: 2, lobes: 5, ripple: 0.1 }, 100).map((p) => Math.hypot(...p));
    let peaks = 0;
    for (let i = 0; i < 100; i += 1) if (edge[i]! > edge[(i + 99) % 100]! && edge[i]! >= edge[(i + 1) % 100]!) peaks += 1;
    expect(peaks).toBe(5);
    expect(Math.max(...edge)).toBeCloseTo(1.1, 3);
  });
});

describe("her shaping tools", () => {
  it("a straight loft is a solid facing outward, with the volume it should have", () => {
    const mesh = loft({ up: 10, from: { width: 4 }, cap: "flat", segments: 96, hand: 0 }, 0, plain);
    expect(soundMesh(mesh)).toBe(true);
    expect(volume(mesh)).toBeGreaterThan(0);
    expect(volume(mesh) / (Math.PI * 4 * 10)).toBeCloseTo(1, 2);
  });

  it("taper, swell and twist change the shape and keep it sound", () => {
    const cone = loft({ up: 9, from: { width: 4 }, taper: 0.02, cap: "flat", segments: 96, rings: 40, hand: 0 }, 0, plain);
    expect(volume(cone) / ((Math.PI * 4 * 9) / 3)).toBeCloseTo(1, 1);
    const swollen = loft({ up: 10, from: { width: 4 }, swell: 0.3, cap: "flat", segments: 48, rings: 30 }, 0, plain);
    expect(volume(swollen)).toBeGreaterThan(Math.PI * 4 * 10);
    const twisted = loft({ up: 10, from: { shape: "block", width: 4 }, to: { shape: "sided", sides: 5, width: 3 }, twist: 120, cap: "flat", rings: 40 }, 0, plain);
    expect(soundMesh(twisted)).toBe(true);
    expect(volume(twisted)).toBeGreaterThan(0);
  });

  it("a loft along a closed curve meets itself: a ring has the volume of a ring", () => {
    const circle = Array.from({ length: 16 }, (_, k) => [Math.cos((k / 16) * Math.PI * 2) * 10, 3, Math.sin((k / 16) * Math.PI * 2) * 10] as [number, number, number]);
    const ring = loft({ through: circle, closed: true, from: { width: 2 }, rings: 160, segments: 48 }, 0, plain);
    expect(soundMesh(ring)).toBe(true);
    expect(Math.abs(volume(ring)) / (2 * Math.PI * Math.PI * 10 * 1)).toBeCloseTo(1, 1);
  });

  it("a loft along a looping, banking track stays sound and does not pinch", () => {
    const track = Array.from({ length: 14 }, (_, k) => [Math.cos((k / 14) * Math.PI * 2) * 20, 9 + 7 * Math.sin((k / 14) * Math.PI * 4), Math.sin((k / 14) * Math.PI * 2) * 20] as [number, number, number]);
    const mesh = loft({ through: track, closed: true, from: { shape: "block", width: 2.6, depth: 0.45 }, rings: 180, segments: 12 }, 0, plain);
    expect(soundMesh(mesh)).toBe(true);
    // Every ring of the ribbon keeps its width: no station collapses or flips.
    for (let r = 0; r < 180; r += 1) expect(Math.hypot(...sub(point(mesh, r * 12), point(mesh, r * 12 + 6)))).toBeGreaterThan(2);
  });

  it("spin makes the same solid whichever way its outline is written", () => {
    const up = spin({ outline: [[0.01, 0], [3, 0], [3, 5], [0.01, 5]], smooth: false, segments: 96 }, 0, hand);
    const down = spin({ outline: [[0.01, 5], [3, 5], [3, 0], [0.01, 0]], smooth: false, segments: 96 }, 0, hand);
    expect(volume(up) / (Math.PI * 9 * 5)).toBeCloseTo(1, 2);
    expect(volume(down)).toBeCloseTo(volume(up), 6);
  });

  it("her noise and her ground are the same every time and level at the edge", () => {
    expect(noise(1.3, 2.7, 5)).toBe(noise(1.3, 2.7, 5));
    expect(noise(1.3, 2.7, 5)).not.toBe(noise(1.3, 2.7, 6));
    for (let k = 0; k < 200; k += 1) expect(Math.abs(noise(k * 0.37, k * 0.11, 9))).toBeLessThanOrEqual(1);
    for (const kind of ["dunes", "rows", "crater", "pool", "terraces"] as const) expect(groundHeight({ width: 40, kind, relief: 2 }, 20, 0)).toBeCloseTo(0, 9);
  });
});

describe("her hand", () => {
  it("crowns an upright shaft with a bell and sets her lights on it", () => {
    const bare = loft({ up: 20, from: { width: 6 }, cap: "flat" }, 0, hand);
    const crowned = loft({ up: 20, from: { width: 6 } }, 0, hand);
    const top = (mesh: Mesh) => Math.max(...mesh.positions.filter((_, i) => i % 3 === 1));
    expect(top(crowned)).toBeGreaterThan(top(bare));
    const count = (mesh: Mesh, name: (typeof MATERIALS)[number]) => mesh.materials.filter((id) => id === MATERIALS.indexOf(name)).length;
    expect(count(crowned, "glow")).toBe(hand.lights * 8);
    expect(count(crowned, "body")).toBeGreaterThan(0);
    expect(count(bare, "glow")).toBe(0);
  });

  it("can be turned down for a part, and comes from her soul", () => {
    const off = loft({ up: 20, from: { width: 6 }, cap: "crown", hand: 0 }, 0, hand);
    expect(off.materials.filter((id) => id === MATERIALS.indexOf("glow"))).toHaveLength(0);
    const other = handFrom(genomeFromSoul("I play and laugh and joke. I am bright and odd and I shine."));
    expect(other).not.toEqual(hand);
  });

  it("gives every material a shade of her own colours and nothing else", () => {
    const look = lookFrom(style);
    expect(Object.keys(look)).toEqual([...MATERIALS]);
    for (const surface of Object.values(look)) expect(surface.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(look.glow.color).toBe(style.palette.accent);
    expect(look.body.color).toBe(style.palette.body);
  });
});

describe("recipes", () => {
  it("the same recipe always makes the same thing, and a different seed a different one", () => {
    const hash = (seed: number) => createHash("sha256").update(encodeMesh(buildRecipe(cleanRecipe(compose("ruin", seed)), hand).mesh)).digest("hex");
    expect(hash(4)).toBe(hash(4));
    expect(hash(4)).not.toBe(hash(5));
  });

  it("every idea she knows builds inside the limits, for many seeds, and survives being written out and read back", () => {
    for (const kind of IDEA_KINDS) {
      for (const seed of [1, 2, 99, 4_000_000_000]) {
        const recipe = cleanRecipe(JSON.parse(JSON.stringify(compose(kind, seed))));
        const built = buildRecipe(recipe, hand);
        expect(built.triangles).toBeLessThanOrEqual(LIMITS.triangles);
        expect(built.radius).toBeLessThanOrEqual(LIMITS.radius);
        expect(built.height).toBeLessThanOrEqual(LIMITS.height);
        expect(soundMesh(built.mesh)).toBe(true);
        expect(recipe.name).toMatch(/^[A-Za-z ]{4,40}$/);
      }
    }
  });

  it("arranging tools multiply a part as asked", () => {
    const one = buildRecipe(cleanRecipe({ name: "One Post", islet: false, parts: [{ op: "loft", up: 2, from: { width: 1 }, cap: "flat", hand: 0 }] }), hand).triangles;
    const made = (extra: object) => buildRecipe(cleanRecipe({ name: "Posts", islet: false, parts: [{ op: "loft", up: 2, from: { width: 1 }, cap: "flat", hand: 0, ...extra }] }), hand);
    expect(made({ repeat: { count: 5, step: [2, 0, 0] } }).triangles).toBe(one * 5);
    expect(made({ around: { count: 6, radius: 8 } }).triangles).toBe(one * 6);
    expect(made({ scatter: { count: 9, spread: [10, 10] } }).triangles).toBe(one * 9);
    expect(made({ at: [3, 0, 0], mirror: "x" }).triangles).toBe(one * 2);
    expect(made({ around: { count: 6, radius: 8 } }).radius).toBeCloseTo(8.5, 1);
    // A mirrored copy still faces outward.
    expect(volume(made({ at: [0, 0, 0], repeat: { count: 1, step: [3, 0, 0] }, mirror: "z" }).mesh)).toBeGreaterThan(0);
  });

  it("refuses what is not a recipe", () => {
    const bad = (value: unknown, code: string) => expect(() => cleanRecipe(value)).toThrow(code);
    bad(null, "FORGE_RECIPE");
    bad({ name: "x", parts: [] }, "FORGE_NAME");
    bad({ name: "Thing", parts: [] }, "FORGE_PARTS");
    bad({ name: "Thing", parts: [{ op: "explode" }] }, "FORGE_TOOL");
    bad({ name: "Thing", parts: [{ op: "loft", from: { width: 1 } }] }, "FORGE_PATH");
    bad({ name: "Thing", parts: [{ op: "loft", up: "tall", from: { width: 1 } }] }, "FORGE_NUMBER");
    bad({ name: "Thing", parts: [{ op: "loft", up: Number.NaN, from: { width: 1 } }] }, "FORGE_NUMBER");
    bad({ name: "Thing", parts: [{ op: "loft", up: 3, from: { width: 1 }, material: "gold" }] }, "FORGE_CHOICE");
    bad({ name: "Thing", parts: [{ op: "spin", outline: [[1, 0]] }] }, "FORGE_OUTLINE");
    bad({ name: "Thing", parts: [{ op: "loft", up: 3, from: { width: 1 }, at: [1, 2] }] }, "FORGE_VECTOR");
    const nest = (depth: number): object => (depth === 0 ? { op: "loft", up: 1, from: { width: 1 } } : { op: "group", parts: [nest(depth - 1)] });
    bad({ name: "Thing", parts: [nest(5)] }, "FORGE_TOO_DEEP");
  });

  it("holds numbers to their range and cleans the name", () => {
    const recipe = cleanRecipe({ name: "  <b>My</b>   tall!!  tower ", parts: [{ op: "loft", up: 9_999, from: { width: 9_999 }, twist: 1e9, bands: 500 }] });
    expect(recipe.name).toBe("b My b tall tower");
    const part = recipe.parts[0] as { up: number; from: { width: number }; twist: number; bands: number };
    expect([part.up, part.from.width, part.twist, part.bands]).toEqual([LIMITS.height, 64, 1440, 40]);
  });

  it("refuses a build that is too large or too heavy, and a name that is not hers", () => {
    expect(() => buildRecipe(cleanRecipe({ name: "Too Wide", parts: [{ op: "loft", up: 5, from: { width: 60 }, at: [20, 0, 0] }] }), hand)).toThrow("FORGE_TOO_BIG");
    expect(() => buildRecipe(cleanRecipe({ name: "Too Many", parts: [{ op: "loft", up: 5, from: { width: 1 }, segments: 96, rings: 200, repeat: { count: 64, step: [0.1, 0, 0] } }] }), hand)).toThrow("FORGE_TOO_HEAVY");
    expect(() => buildRecipe(cleanRecipe({ name: "Too Strewn", parts: [{ op: "group", parts: [{ op: "loft", up: 1, from: { width: 1 }, segments: 24, rings: 6, cap: "flat", hand: 0, scatter: { count: 200, spread: [10, 10] } }], repeat: { count: 64, step: [0, 0, 0] } }] }), hand)).toThrow("FORGE_TOO_HEAVY");
    for (const name of ["Eiffel Tower", "Disney Castle", "Nike Store", "Empire State Tower"]) expect(() => cleanRecipe({ name, parts: [{ op: "loft", up: 1, from: { width: 1 } }] })).toThrow("FORGE_NAME_NOT_HERS");
    expect(cleanRecipe({ name: "Wall Street", parts: [{ op: "loft", up: 1, from: { width: 1 } }] }).name).toBe("Wall Street");
  });
});

describe("mesh bytes and her viewport", () => {
  it("writes the mesh in the layout the world's renderer reads", () => {
    const built = buildRecipe(cleanRecipe(tower), hand);
    const bytes = encodeMesh(built.mesh);
    const points = built.mesh.positions.length / 3;
    expect(bytes.toString("latin1", 0, 4)).toBe("ZMSH");
    expect(bytes.readUInt32LE(4)).toBe(points);
    expect(bytes.readUInt32LE(8)).toBe(built.triangles);
    let total = 0;
    for (let i = 0; i < MATERIALS.length; i += 1) total += bytes.readUInt32LE(12 + i * 4);
    expect(total).toBe(built.triangles);
    expect(bytes.length).toBe(12 + MATERIALS.length * 4 + points * 12 + built.triangles * 12);
    for (let i = 0; i < built.triangles * 3; i += 1) expect(bytes.readUInt32LE(12 + MATERIALS.length * 4 + points * 12 + i * 4)).toBeLessThan(points);
  });

  it("draws the build, the same every time, and it stands out from the water", () => {
    const built = buildRecipe(cleanRecipe(tower), hand);
    const draw = () => renderMesh(built.mesh, lookFrom(style), style, { width: 120, height: 150, lift: built.isletRadius * 0.85 });
    const first = draw();
    expect(Buffer.from(first.data.buffer).equals(Buffer.from(draw().data.buffer))).toBe(true);
    const empty = renderMesh({ positions: [0, 0, 0, 1, 0, 0, 0, 0, 1], indices: [], materials: [] }, lookFrom(style), style, { width: 120, height: 150 });
    expect(Buffer.from(first.data.buffer).equals(Buffer.from(empty.data.buffer))).toBe(false);
    expect(encodePng(first).length).toBeGreaterThan(1_000);
    let lit = 0;
    for (let i = 0; i < first.data.length; i += 4) if (first.data[i]! > 0.5) lit += 1;
    expect(lit).toBeGreaterThan(40);
  });
});

describe("what she has built", () => {
  it("sites never touch each other or her island", () => {
    const widest = LIMITS.radius * 1.1 + 1;
    expect(FORGE.site).toBeGreaterThan(widest * 2);
    for (let i = -6; i <= 6; i += 1) {
      for (let j = -6; j <= 6; j += 1) {
        if (islandCell(i, j)) continue;
        const spot = siteAt(i, j);
        expect(Math.hypot(spot.x, spot.z)).toBeGreaterThan(72 + widest);
      }
    }
  });

  it("raises, reshapes, undoes and takes down, keeping every version", () => {
    const db = openDatabase();
    const built = raise(db, tower, T, "owner", "own", hand);
    expect(built).toMatchObject({ name: "Test Tower", version: 1, status: "standing", parent: "island" });
    expect(meshBytes(db, built.id)?.toString("latin1", 0, 4)).toBe("ZMSH");
    expect(pictureBytes(db, built.id)?.subarray(1, 4).toString("latin1")).toBe("PNG");
    const taller = reshape(db, built.id, { ...tower, name: "Taller Tower", parts: [{ ...tower.parts[0], up: 40 }] }, T + 1, hand);
    expect(taller).toMatchObject({ name: "Taller Tower", version: 2 });
    expect(taller.height).toBeGreaterThan(built.height);
    expect(undo(db, built.id, T + 2, hand)).toMatchObject({ name: "Test Tower", version: 1 });
    expect(recipeOf(db, built.id)?.name).toBe("Test Tower");
    const second = raise(db, { ...tower, name: "Second Tower" }, T + 3, "owner", "own", hand);
    expect([second.si, second.sj]).not.toEqual([built.si, built.sj]);
    expect(undo(db, built.id, T + 4, hand).status).toBe("removed");
    expect(meshBytes(db, built.id)).toBeNull();
    // A freed site is used again.
    const third = raise(db, { ...tower, name: "Third Tower" }, T + 5, "owner", "own", hand);
    expect([third.si, third.sj]).toEqual([built.si, built.sj]);
    expect(remove(db, second.id, T + 6).status).toBe("removed");
    expect(() => remove(db, second.id, T + 7)).toThrow("FORGE_UNKNOWN");
    expect(() => raise(db, { name: "Bad", parts: [{ op: "nope" }] }, T, "owner", "own", hand)).toThrow("FORGE_TOOL");
    expect(standing(db)).toHaveLength(1);
  });

  it("her land grows outward in one piece: every build touches her island or something she built", () => {
    const db = openDatabase();
    const builds = Array.from({ length: 30 }, (_, k) => raise(db, { ...tower, name: `Tower ${String.fromCharCode(65 + (k % 26))}${k}` }, T + k, "owner", "own", hand));
    const at = new Map(builds.map((build) => [`${build.si},${build.sj}`, build]));
    expect(at.size).toBe(30);
    for (const build of builds) {
      expect(islandCell(build.si, build.sj)).toBe(false);
      const sides = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([di, dj]) => [build.si + di!, build.sj + dj!] as const);
      if (build.parent === "island") expect(sides.some(([i, j]) => islandCell(i, j))).toBe(true);
      else {
        const parent = builds.find((other) => other.id === build.parent)!;
        expect(sides.some(([i, j]) => i === parent.si && j === parent.sj)).toBe(true);
        // The path leads toward home, and its far end was built first.
        expect(Math.hypot(parent.si, parent.sj)).toBeLessThan(Math.hypot(build.si, build.sj));
        expect(builds.indexOf(parent)).toBeLessThan(builds.indexOf(build));
      }
    }
    // Nearest home first: the eight sites beside the island fill before anything further out.
    expect(builds.slice(0, 8).every((build) => build.parent === "island")).toBe(true);
    expect(builds[8]!.parent).not.toBe("island");
  });

  it("a build's mesh carries its path, which ends at the neighbour it leads to", () => {
    const db = openDatabase();
    const builds = Array.from({ length: 9 }, (_, k) => raise(db, { ...tower, name: `Tower ${String.fromCharCode(65 + k)}` }, T + k, "owner", "own", hand));
    const outer = builds[8]!;
    const parent = builds.find((build) => build.id === outer.parent)!;
    const bytes = meshBytes(db, outer.id)!;
    expect(bytes.readUInt32LE(8)).toBeGreaterThan(outer.triangles);
    // In the build's own frame the path reaches most of the way to the neighbour, 90 metres off.
    const points = bytes.readUInt32LE(4);
    let reach = 0;
    for (let i = 0; i < points; i += 1) reach = Math.max(reach, Math.hypot(bytes.readFloatLE(44 + i * 12), bytes.readFloatLE(44 + i * 12 + 8)));
    expect(reach).toBeGreaterThan(FORGE.site - parent.radius);
    expect(reach).toBeLessThan(FORGE.site);
    // Changing the neighbour changes the path, so the world is told to fetch this build again.
    const before = revOf(db, outer);
    reshape(db, parent.id, { ...tower, name: "Wider", parts: [{ ...tower.parts[0], from: { shape: "block", width: 20 } }] }, T + 50, hand);
    expect(revOf(db, getBuild(db, outer.id)!)).not.toBe(before);
    expect(meshBytes(db, outer.id)!.equals(bytes)).toBe(false);
  });

  it("nothing is taken down if that would cut other builds off from her island", () => {
    const db = openDatabase();
    const builds = Array.from({ length: 9 }, (_, k) => raise(db, { ...tower, name: `Tower ${String.fromCharCode(65 + k)}` }, T + k, "owner", "own", hand));
    const outer = builds[8]!;
    const holds = builds.find((build) => build.id === outer.parent)!;
    // Take down every root except the one the outer build hangs from, so it is the only way home.
    for (const build of builds.slice(0, 8)) {
      if (build.id === holds.id) continue;
      const sides = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([di, dj]) => build.si + di! === outer.si && build.sj + dj! === outer.sj);
      if (sides) remove(db, build.id, T + 20);
    }
    expect(() => remove(db, holds.id, T + 30)).toThrow("FORGE_HOLDS_PATH");
    expect(() => undo(db, holds.id, T + 30, hand)).toThrow("FORGE_HOLDS_PATH");
    expect(getBuild(db, holds.id)?.status).toBe("standing");
    // Once the outer build is gone, the one that held its path can come down.
    remove(db, outer.id, T + 40);
    expect(remove(db, holds.id, T + 50).status).toBe("removed");
  });

  it("a build whose neighbour comes down is given a path to another", () => {
    const db = openDatabase();
    const builds = Array.from({ length: 10 }, (_, k) => raise(db, { ...tower, name: `Tower ${String.fromCharCode(65 + k)}` }, T + k, "owner", "own", hand));
    const child = builds.find((build) => build.parent !== "island" && [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([di, dj]) => builds.some((other) => other.si === build.si + di! && other.sj === build.sj + dj!)).length >= 2);
    if (!child) return;
    const old = child.parent;
    remove(db, old, T + 60);
    const now = getBuild(db, child.id)!;
    expect(now.parent).not.toBe(old);
    expect(now.status).toBe("standing");
  });

  it("she builds when it is due, at most a few a day, and not when the creative switch is off", () => {
    const db = openDatabase();
    const first = considerForge(db, calm, T)!;
    expect(first.by).toBe("zoora");
    expect(["tank", "fields"]).toContain(first.kind);
    expect((db.prepare("SELECT text FROM diary ORDER BY id DESC LIMIT 1").get() as { text: string }).text).toContain(first.name);
    expect(considerForge(db, calm, T + FORGE.everyMs - 1)).toBeNull();
    for (let k = 1; k < FORGE.perDay; k += 1) expect(considerForge(db, calm, T + FORGE.everyMs * k)).not.toBeNull();
    // The day's count is reached, so the next is refused even though the wait has passed.
    expect(considerForge(db, calm, T + FORGE.everyMs * FORGE.perDay)).toBeNull();
    expect(standing(db)).toHaveLength(FORGE.perDay);
    setCreativeEnabled(db, false);
    expect(forgeDue(db, T + 10 * 86_400_000)).toBe(false);
    expect(considerForge(db, calm, T + 10 * 86_400_000)).toBeNull();
  });

  it("she reaches for what she has built least", () => {
    const db = openDatabase();
    const kinds = Array.from({ length: 4 }, (_, k) => considerForge(db, calm, T + FORGE.everyMs * k)!.kind);
    expect(new Set(kinds).size).toBeGreaterThanOrEqual(3);
  });

  it("a design of her own is raised when it is sound, and she falls back to what she knows when it is not", () => {
    const db = openDatabase();
    const own = considerForge(db, calm, T, { name: "Glass Stair", seed: 8, parts: [{ op: "loft", material: "glass", up: 12, from: { shape: "sided", sides: 5, width: 4 }, twist: 200 }] })!;
    expect(own).toMatchObject({ name: "Glass Stair", kind: "own", by: "zoora" });
    const fallback = considerForge(db, calm, T + FORGE.everyMs, { name: "Broken", parts: [{ op: "summon", what: "a demon" }] })!;
    expect(fallback.kind).not.toBe("own");
    const branded = considerForge(db, calm, T + FORGE.everyMs * 2, { name: "Disney Castle", parts: [{ op: "loft", up: 5, from: { width: 2 } }] })!;
    expect(branded.name).not.toContain("Disney");
    expect(getBuild(db, own.id)?.triangles).toBe(triangleCount(buildRecipe(recipeOf(db, own.id)!, herHand()).mesh));
  });
});
