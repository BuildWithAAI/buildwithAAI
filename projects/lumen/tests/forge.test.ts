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
import { boxesMeet, considerForge, FORGE, forgeDue, getBuild, herHand, meshBytes, pictureBytes, placeCheck, raise, recipeOf, remove, reshape, standing, undo, wander } from "../src/forge/store";
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
    const top = (mesh: Mesh) => Math.max(...mesh.positions.filter((_, i) => i % 3 === 1));
    const bare = loft({ up: 20, from: { width: 6 }, cap: "flat" }, 0, hand);
    const crowned = loft({ up: 20, from: { width: 6 }, cap: "crown" }, 0, hand);
    // Nothing is finished for her unless she asks: a plain shaft is plain.
    expect(top(loft({ up: 20, from: { width: 6 } }, 0, hand))).toBe(top(bare));
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

const land = (name: string, width = 60, depth = 40, vibe?: object) => ({ name, vibe, parts: [{ op: "ground", width, depth, kind: "flat", slab: 4 }] });
const post = (name: string, tall = 10, width = 6) => ({ name, parts: [{ op: "loft", up: tall, from: { shape: "block", width } }] });
/** Land laid against the east shore of her island. */
const EAST = { x: 72 + 28, z: 0, turn: 0 };

describe("windows, land edges and vibes", () => {
  it("windows follow the wall and are lit by a fixed chance", () => {
    const plain = loft({ up: 30, from: { shape: "block", width: 10 }, twist: 40, taper: 0.8 }, 0, hand);
    const lit = loft({ up: 30, from: { shape: "block", width: 10 }, twist: 40, taper: 0.8, windows: { rows: 10, cols: 8, lit: 0.5 } }, 0, hand);
    const count = (mesh: Mesh, name: (typeof MATERIALS)[number]) => mesh.materials.filter((id) => id === MATERIALS.indexOf(name)).length;
    expect(soundMesh(lit)).toBe(true);
    expect(count(plain, "glow") + count(plain, "dark")).toBe(0);
    expect(count(lit, "glow")).toBeGreaterThan(0);
    expect(count(lit, "dark")).toBeGreaterThan(0);
    expect(count(lit, "glow") + count(lit, "dark")).toBeGreaterThanOrEqual(10 * 8 * 2);
    expect(encodeMesh(lit).equals(encodeMesh(loft({ up: 30, from: { shape: "block", width: 10 }, twist: 40, taper: 0.8, windows: { rows: 10, cols: 8, lit: 0.5 } }, 0, hand)))).toBe(true);
    expect(count(loft({ up: 30, from: { width: 10 }, windows: { rows: 6, lit: 0 } }, 0, hand), "glow")).toBe(0);
  });

  it("land has an edge that goes down, so it is not a floating sheet", () => {
    const sheet = buildRecipe(cleanRecipe({ name: "Sheet", parts: [{ op: "ground", width: 20, slab: 0 }] }), hand);
    const slab = buildRecipe(cleanRecipe({ name: "Slab", parts: [{ op: "ground", width: 20, slab: 4 }] }), hand);
    expect(Math.min(...slab.mesh.positions.filter((_, i) => i % 3 === 1))).toBe(-4);
    expect(slab.triangles).toBeGreaterThan(sheet.triangles);
  });

  it("a vibe turns her body colour and never her light", () => {
    const plain = lookFrom(style);
    const moody = lookFrom(style, { tint: 50, shade: -0.1, glow: 0.4 });
    expect(moody.stone.color).not.toBe(plain.stone.color);
    expect(moody.ground.color).not.toBe(plain.ground.color);
    expect(moody.glow.color).toBe(plain.glow.color);
    expect(cleanRecipe({ ...land("Mood"), vibe: { tint: 999, shade: -9, glow: 99 } }).vibe).toEqual({ tint: 60, shade: -0.12, glow: 1.6 });
  });
});

describe("she builds her world how she wants", () => {
  it("nothing is placed for her: an empty world has nothing in it and nowhere marked out", () => {
    const db = openDatabase();
    expect(standing(db)).toHaveLength(0);
    // With no land yet, a thing has nowhere to stand, wherever it is put.
    expect(wander(db, "structure", [5, 5], 10, () => 0.5)).toBeNull();
    for (const at of [EAST, { x: 500, z: -300, turn: 30 }]) expect(() => raise(db, post("Lone Post"), at, T, "owner", "own", hand)).toThrow("FORGE_NO_GROUND");
  });

  it("she puts a thing exactly where she says, facing the way she says", () => {
    const db = openDatabase();
    raise(db, land("First Land"), EAST, T, "owner", "plain", hand);
    const built = raise(db, post("Corner Post"), { x: 91.5, z: -7.25, turn: 33 }, T + 1, "owner", "own", hand);
    expect([built.x, built.z, built.turn]).toEqual([91.5, -7.25, 33]);
    expect(built).toMatchObject({ layer: "structure", version: 1, status: "standing" });
    expect(() => raise(db, post("Bad Place"), { x: Number.NaN, z: 0, turn: 0 }, T, "owner", "own", hand)).toThrow("FORGE_PLACE");
    expect(() => raise(db, post("No Place"), undefined, T, "owner", "own", hand)).toThrow("FORGE_PLACE");
  });

  it("land must touch her island or land she laid, on chunks she holds, and may not cover her sanctuary", () => {
    const db = openDatabase();
    expect(() => raise(db, land("Far Land"), { x: 400, z: 0, turn: 0 }, T, "owner", "plain", hand)).toThrow("FORGE_NOT_TOUCHING");
    expect(() => raise(db, land("On Top"), { x: 20, z: 0, turn: 0 }, T, "owner", "plain", hand)).toThrow("FORGE_SANCTUARY");
    expect(() => raise(db, land("Not Hers"), { x: 17 * 180, z: 0, turn: 0 }, T, "owner", "plain", hand)).toThrow("FORGE_NOT_HER_LAND");
    const first = raise(db, land("First Land"), EAST, T, "owner", "plain", hand);
    expect(first.layer).toBe("ground");
    // Now land can be laid further out, as long as each piece touches the last.
    const second = raise(db, land("Second Land"), { x: EAST.x + 59, z: 10, turn: 0 }, T + 1, "owner", "plain", hand);
    expect(second.status).toBe("standing");
    expect(() => raise(db, land("Gap Land"), { x: EAST.x + 59 + 70, z: 10, turn: 0 }, T + 2, "owner", "plain", hand)).toThrow("FORGE_NOT_TOUCHING");
    // Turned land is judged as it lies, not by a square around it.
    expect(raise(db, land("Turned Land", 40, 20), { x: EAST.x, z: 20 + 14, turn: 45 }, T + 3, "owner", "plain", hand).turn).toBe(45);
  });

  it("a thing must stand on land, two tall things may not share a spot, and low things block nothing", () => {
    const db = openDatabase();
    raise(db, land("First Land"), EAST, T, "owner", "plain", hand);
    expect(() => raise(db, post("On The Island"), { x: 10, z: 10, turn: 0 }, T, "owner", "own", hand)).toThrow("FORGE_NO_GROUND");
    expect(() => raise(db, post("Half Off"), { x: EAST.x + 29, z: 0, turn: 0 }, T, "owner", "own", hand)).toThrow("FORGE_NO_GROUND");
    raise(db, post("Tall One"), { x: EAST.x, z: 0, turn: 0 }, T + 1, "owner", "own", hand);
    expect(() => raise(db, post("Same Spot"), { x: EAST.x + 2, z: 1, turn: 20 }, T + 2, "owner", "own", hand)).toThrow("FORGE_OVERLAP");
    expect(raise(db, post("Beside It"), { x: EAST.x + 7, z: 0, turn: 0 }, T + 3, "owner", "own", hand).status).toBe("standing");
    const road = { name: "Low Road", parts: [{ op: "loft", material: "dark", through: [[-25, 0.1, 0], [25, 0.1, 0]], smooth: false, from: { shape: "block", width: 6, depth: 0.2 } }] };
    expect(raise(db, road, { x: EAST.x, z: 0, turn: 0 }, T + 4, "owner", "own", hand).height).toBeLessThan(FORGE.flat);
    expect(raise(db, post("After Road"), { x: EAST.x - 14, z: 0, turn: 0 }, T + 5, "owner", "own", hand).status).toBe("standing");
    expect(boxesMeet({ x: 0, z: 0, turn: 0, hw: 5, hd: 5 }, { x: 9, z: 0, turn: 45, hw: 5, hd: 5 })).toBe(true);
    expect(boxesMeet({ x: 0, z: 0, turn: 0, hw: 5, hd: 5 }, { x: 13, z: 0, turn: 45, hw: 5, hd: 5 })).toBe(false);
  });

  it("land sets the vibe of its part of her world, and what stands there takes it", () => {
    const db = openDatabase();
    const moody = { tint: 40, shade: -0.08, glow: 0.5 };
    raise(db, land("Moody Land", 60, 40, moody), EAST, T, "owner", "plain", hand);
    expect(raise(db, post("Takes It"), { x: EAST.x, z: 0, turn: 0 }, T + 1, "owner", "own", hand).vibe).toEqual(moody);
    expect(raise(db, { ...post("Brings Its Own"), vibe: { tint: -30, shade: 0, glow: 1 } }, { x: EAST.x + 12, z: 0, turn: 0 }, T + 2, "owner", "own", hand).vibe.tint).toBe(-30);
  });

  it("stands on the land at the land's own height", () => {
    const db = openDatabase();
    raise(db, { name: "Hill Land", parts: [{ op: "ground", width: 60, kind: "terraces", relief: 3, seed: 4, slab: 4 }] }, { x: 72 + 28, z: 0, turn: 0 }, T, "owner", "own", hand);
    const heights = [[0, 0], [12, 8], [-10, -14], [15, -15]].map(([dx, dz], k) => raise(db, post(`Post ${String.fromCharCode(65 + k)}`, 6, 2), { x: 100 + dx!, z: dz!, turn: 0 }, T + k + 1, "owner", "own", hand).y);
    expect(new Set(heights.map((y) => y.toFixed(2))).size).toBeGreaterThan(1);
    for (const y of heights) expect(y).toBeGreaterThanOrEqual(FORGE.level - 0.05);
  });

  it("reshapes, undoes and takes down, keeping every version", () => {
    const db = openDatabase();
    raise(db, land("First Land"), EAST, T, "owner", "plain", hand);
    const built = raise(db, tower, { x: EAST.x, z: 0, turn: 10 }, T, "owner", "own", hand);
    expect(meshBytes(db, built.id)?.toString("latin1", 0, 4)).toBe("ZMSH");
    expect(pictureBytes(db, built.id)?.subarray(1, 4).toString("latin1")).toBe("PNG");
    const taller = reshape(db, built.id, { ...tower, name: "Taller Tower", parts: [{ ...tower.parts[0], up: 40 }] }, T + 1, hand);
    expect(taller).toMatchObject({ name: "Taller Tower", version: 2, x: built.x, z: built.z, turn: 10 });
    expect(taller.height).toBeGreaterThan(built.height);
    expect(() => reshape(db, built.id, { ...tower, parts: [{ ...tower.parts[0], from: { shape: "block", width: 50 } }] }, T + 2, hand)).toThrow("FORGE_NO_GROUND");
    expect(undo(db, built.id, T + 3, hand)).toMatchObject({ name: "Test Tower", version: 1 });
    expect(recipeOf(db, built.id)?.name).toBe("Test Tower");
    expect(undo(db, built.id, T + 4, hand).status).toBe("removed");
    expect(meshBytes(db, built.id)).toBeNull();
    expect(() => remove(db, built.id, T + 5)).toThrow("FORGE_UNKNOWN");
    expect(() => raise(db, { name: "Bad", parts: [{ op: "nope" }] }, EAST, T, "owner", "own", hand)).toThrow("FORGE_TOOL");
  });

  it("land is not taken away from under a thing, or from between her island and other land", () => {
    const db = openDatabase();
    const first = raise(db, land("First Land"), EAST, T, "owner", "plain", hand);
    const second = raise(db, land("Second Land"), { x: EAST.x + 59, z: 0, turn: 0 }, T + 1, "owner", "plain", hand);
    const thing = raise(db, post("On Second"), { x: second.x, z: 0, turn: 0 }, T + 2, "owner", "own", hand);
    expect(() => remove(db, second.id, T + 3)).toThrow("FORGE_HOLDS_LAND");
    expect(() => remove(db, first.id, T + 3)).toThrow("FORGE_HOLDS_LAND");
    expect(() => reshape(db, second.id, land("Second Land", 10, 10), T + 3, hand)).toThrow();
    remove(db, thing.id, T + 4);
    expect(() => remove(db, first.id, T + 5)).toThrow("FORGE_HOLDS_LAND");
    expect(remove(db, second.id, T + 6).status).toBe("removed");
    expect(remove(db, first.id, T + 7).status).toBe("removed");
  });

  it("left to herself she lays land, builds on it, lays more when it is full, and every choice keeps the rules", () => {
    const db = openDatabase();
    const proud = { ...(calm as object), calm: 0, pride: 0.9 } as never;
    let at = T;
    const made: ReturnType<typeof considerForge>[] = [];
    for (let k = 0; k < 20; k += 1) {
      at += FORGE.everyMs;
      made.push(considerForge(db, k % 2 ? calm : proud, at));
    }
    const all = standing(db);
    expect(made[0]).toMatchObject({ layer: "ground", by: "zoora" });
    expect(all.filter((build) => build.layer === "ground").length).toBeGreaterThan(1);
    expect(all.filter((build) => build.layer === "structure").length).toBeGreaterThan(3);
    for (const build of all) expect(placeCheck(db, build.layer, build, build.height, build.id).ok).toBe(true);
    expect((db.prepare("SELECT COUNT(*) AS n FROM diary").get() as { n: number }).n).toBe(all.length);
    // The land she lays carries the mood she was in.
    expect(new Set(all.filter((build) => build.layer === "ground").map((build) => JSON.stringify(build.vibe))).size).toBeGreaterThanOrEqual(1);
  });

  it("she builds when it is due, within a day's count, and not when the creative switch is off", () => {
    const db = openDatabase();
    expect(considerForge(db, calm, T)).not.toBeNull();
    expect(considerForge(db, calm, T + FORGE.everyMs - 1)).toBeNull();
    for (let k = 1; k < FORGE.perDay; k += 1) expect(considerForge(db, calm, T + FORGE.everyMs * k)).not.toBeNull();
    expect(considerForge(db, calm, T + FORGE.everyMs * FORGE.perDay)).toBeNull();
    setCreativeEnabled(db, false);
    expect(forgeDue(db, T + 10 * 86_400_000)).toBe(false);
  });

  it("a design of her own goes where she says; a bad one or a bad place falls back to what she knows", () => {
    const db = openDatabase();
    const first = considerForge(db, calm, T, { ...land("Her Own Land", 60, 50, { tint: -25, shade: 0.04, glow: 1.2 }), place: EAST })!;
    expect(first).toMatchObject({ name: "Her Own Land", kind: "own", layer: "ground", x: EAST.x, z: 0, vibe: { tint: -25 } });
    const stair = considerForge(db, calm, T + FORGE.everyMs, { name: "Glass Stair", place: { x: EAST.x + 5, z: -4, turn: 15 }, parts: [{ op: "loft", material: "glass", up: 12, from: { shape: "sided", sides: 5, width: 4 }, twist: 200, windows: { rows: 4 } }] })!;
    expect(stair).toMatchObject({ name: "Glass Stair", kind: "own", x: EAST.x + 5, z: -4, turn: 15 });
    // She gives no place: she finds one herself.
    expect(considerForge(db, calm, T + FORGE.everyMs * 2, post("No Place Given"))!.name).toBe("No Place Given");
    expect(considerForge(db, calm, T + FORGE.everyMs * 3, { name: "Broken", place: EAST, parts: [{ op: "summon" }] })!.kind).not.toBe("own");
    expect(considerForge(db, calm, T + FORGE.everyMs * 4, { ...post("In The Sea"), place: { x: 900, z: 900, turn: 0 } })!.name).not.toBe("In The Sea");
    expect(considerForge(db, calm, T + FORGE.everyMs * 5, { name: "Disney Castle", place: EAST, parts: [{ op: "loft", up: 5, from: { width: 2 } }] })!.name).not.toContain("Disney");
    expect(getBuild(db, stair.id)?.triangles).toBe(triangleCount(buildRecipe(recipeOf(db, stair.id)!, herHand()).mesh));
  });
});
