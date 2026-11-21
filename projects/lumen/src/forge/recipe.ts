import { rng } from "../form/genome";
import type { Hand } from "./hand";
import { append, bounds, emptyMesh, MATERIALS, soundMesh, triangleCount, type MaterialName, type Mesh, type Placement, type Vec3 } from "./mesh";
import { ground, islet, loft, spin, type GroundSpec, type LoftSpec, type Point2, type ProfileSpec, type SpinSpec } from "./shape";

/**
 * A recipe is how she builds: a named list of parts, each made with one shaping tool, then placed,
 * repeated, mirrored or scattered. It is plain data. She writes it, the forge checks it, and the same
 * recipe always makes the same thing, so every build can be kept, changed and undone.
 *
 * A recipe is checked hard, because it may be written by a model. Unknown tools are refused. Numbers
 * are held to a range. A build that is too heavy or too large is refused, so one build can never slow
 * her world or cover her neighbours.
 */

export const LIMITS = { triangles: 120_000, radius: 32, height: 140, below: 24, parts: 80, depth: 3, instances: 600 } as const;

type Arrange = {
  material?: MaterialName;
  at?: Vec3;
  turn?: number;
  tip?: number;
  roll?: number;
  size?: number | Vec3;
  /** A row: each copy moved, turned and grown a step further. */
  repeat?: { count: number; step: Vec3; turn?: number; grow?: number };
  /** A circle of copies, each facing outward. */
  around?: { count: number; radius: number };
  mirror?: "x" | "z";
  /** Copies strewn over a patch, each turned and sized by chance from the recipe's seed. */
  scatter?: { count: number; spread: [number, number]; size?: [number, number] };
};

export type Part = Arrange & (({ op: "loft" } & LoftSpec) | ({ op: "spin" } & SpinSpec) | ({ op: "ground" } & GroundSpec) | { op: "group"; parts: Part[] });
export type Recipe = { name: string; seed: number; islet: boolean; parts: Part[] };

const NOT_HERS = /\b(disney|pixar|marvel|nintendo|pokemon|lego|nike|apple|google|tesla|coca|mcdonald|starbucks|eiffel|empire state|burj|big ben|taj mahal|statue of liberty|space needle|trump|taylor swift)\b/i;

function fail(code: string): never {
  throw new Error(code);
}

function num(value: unknown, low: number, high: number, fallback?: number): number {
  if (value === undefined || value === null) return fallback ?? fail("FORGE_MISSING");
  if (typeof value !== "number" || !Number.isFinite(value)) fail("FORGE_NUMBER");
  return Math.min(high, Math.max(low, value as number));
}

function optional(value: unknown, low: number, high: number): number | undefined {
  return value === undefined || value === null ? undefined : num(value, low, high);
}

function vec(value: unknown, low: number, high: number): Vec3 {
  if (!Array.isArray(value) || value.length !== 3) fail("FORGE_VECTOR");
  return [num((value as unknown[])[0], low, high), num((value as unknown[])[1], low, high), num((value as unknown[])[2], low, high)];
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback?: T): T | undefined {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) fail("FORGE_CHOICE");
  return value as T;
}

function outline(value: unknown): ProfileSpec {
  const v = (value ?? fail("FORGE_MISSING")) as Record<string, unknown>;
  if (typeof v !== "object") fail("FORGE_PROFILE");
  return { shape: pick(v.shape, ["round", "sided", "block"] as const), width: num(v.width, 0.02, 64), depth: optional(v.depth, 0.02, 64), sides: optional(v.sides, 3, 16), soft: optional(v.soft, 0, 1), lobes: optional(v.lobes, 0, 32), ripple: optional(v.ripple, 0, 0.3) };
}

function cleanPart(value: unknown, depth: number): Part {
  if (!value || typeof value !== "object") fail("FORGE_PART");
  const v = value as Record<string, unknown>;
  const arrange: Arrange = {
    material: pick(v.material, MATERIALS),
    at: v.at === undefined ? undefined : vec(v.at, -LIMITS.radius, LIMITS.height),
    turn: optional(v.turn, -3600, 3600),
    tip: optional(v.tip, -180, 180),
    roll: optional(v.roll, -180, 180),
    size: v.size === undefined ? undefined : Array.isArray(v.size) ? vec(v.size, 0.05, 20) : num(v.size, 0.05, 20),
    mirror: pick(v.mirror, ["x", "z"] as const),
  };
  if (v.repeat !== undefined) {
    const r = v.repeat as Record<string, unknown>;
    arrange.repeat = { count: Math.round(num(r?.count, 1, 64)), step: vec(r?.step, -64, 64), turn: optional(r?.turn, -360, 360), grow: optional(r?.grow, 0.5, 1.5) };
  }
  if (v.around !== undefined) {
    const a = v.around as Record<string, unknown>;
    arrange.around = { count: Math.round(num(a?.count, 1, 64)), radius: num(a?.radius, 0, LIMITS.radius) };
  }
  if (v.scatter !== undefined) {
    const s = v.scatter as Record<string, unknown>;
    const spread = Array.isArray(s?.spread) && s.spread.length === 2 ? s.spread : fail("FORGE_VECTOR");
    const size = s.size === undefined ? undefined : Array.isArray(s.size) && s.size.length === 2 ? ([num(s.size[0], 0.1, 5), num(s.size[1], 0.1, 5)] as [number, number]) : fail("FORGE_VECTOR");
    arrange.scatter = { count: Math.round(num(s.count, 1, 200)), spread: [num(spread[0], 0, LIMITS.radius * 2), num(spread[1], 0, LIMITS.radius * 2)], size };
  }
  if (v.op === "loft") {
    let through: Vec3[] | undefined;
    if (v.through !== undefined) {
      if (!Array.isArray(v.through) || v.through.length < 2 || v.through.length > 64) fail("FORGE_PATH");
      through = (v.through as unknown[]).map((p) => vec(p, -LIMITS.height, LIMITS.height));
    }
    if (!through && v.up === undefined) fail("FORGE_PATH");
    return { ...arrange, op: "loft", up: through ? undefined : num(v.up, 0.02, LIMITS.height), through, closed: v.closed === true, smooth: v.smooth !== false, from: outline(v.from), to: v.to === undefined ? undefined : outline(v.to), rings: optional(v.rings, 2, 200), segments: optional(v.segments, 6, 96), taper: optional(v.taper, 0.02, 4), swell: optional(v.swell, -0.5, 1), twist: optional(v.twist, -1440, 1440), cap: pick(v.cap, ["flat", "crown", "open"] as const), bands: optional(v.bands, 0, 40), hand: optional(v.hand, 0, 1) };
  }
  if (v.op === "spin") {
    if (!Array.isArray(v.outline) || v.outline.length < 2 || v.outline.length > 48) fail("FORGE_OUTLINE");
    const points = (v.outline as unknown[]).map((p) => (Array.isArray(p) && p.length === 2 ? ([num(p[0], 0, LIMITS.radius), num(p[1], -LIMITS.below, LIMITS.height)] as Point2) : fail("FORGE_OUTLINE")));
    return { ...arrange, op: "spin", outline: points, segments: optional(v.segments, 6, 96), smooth: v.smooth !== false, ripple: optional(v.ripple, 0, 0.3), cap: pick(v.cap, ["flat", "open", "top-open"] as const), hand: optional(v.hand, 0, 1) };
  }
  if (v.op === "ground") {
    return { ...arrange, op: "ground", width: num(v.width, 0.5, LIMITS.radius * 2), depth: optional(v.depth, 0.5, LIMITS.radius * 2), kind: pick(v.kind, ["flat", "dunes", "rows", "crater", "pool", "terraces"] as const), relief: optional(v.relief, 0, 12), cells: optional(v.cells, 2, 96), seed: optional(v.seed, 0, 4294967295), rows: optional(v.rows, 1, 60), round: v.round === true };
  }
  if (v.op === "group") {
    if (depth >= LIMITS.depth) fail("FORGE_TOO_DEEP");
    if (!Array.isArray(v.parts) || v.parts.length < 1 || v.parts.length > LIMITS.parts) fail("FORGE_PARTS");
    return { ...arrange, op: "group", parts: (v.parts as unknown[]).map((part) => cleanPart(part, depth + 1)) };
  }
  return fail("FORGE_TOOL");
}

/** Checks a recipe and returns it tidied. Anything that is not a recipe in this language is refused. */
export function cleanRecipe(input: unknown): Recipe {
  if (!input || typeof input !== "object") fail("FORGE_RECIPE");
  const v = input as Record<string, unknown>;
  const name = String(v.name ?? "").replace(/[^A-Za-z0-9 '\-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
  if (name.length < 2) fail("FORGE_NAME");
  // Her world is her own. Nothing in it is named for someone else's brand or a real landmark.
  if (NOT_HERS.test(name)) fail("FORGE_NAME_NOT_HERS");
  if (!Array.isArray(v.parts) || v.parts.length < 1 || v.parts.length > LIMITS.parts) fail("FORGE_PARTS");
  return { name, seed: Math.round(num(v.seed, 0, 4294967295, 1)), islet: v.islet !== false, parts: (v.parts as unknown[]).map((part) => cleanPart(part, 0)) };
}

type Run = { hand: Hand; next: () => number; instances: number; triangles: number };

function make(part: Part, run: Run): Mesh {
  const material = MATERIALS.indexOf(part.material ?? "stone");
  let shape: Mesh;
  if (part.op === "loft") shape = loft(part, material, run.hand);
  else if (part.op === "spin") shape = spin(part, material, run.hand);
  else if (part.op === "ground") shape = ground({ ...part, seed: part.seed ?? Math.floor(run.next() * 4294967295) }, MATERIALS.indexOf(part.material ?? "ground"));
  else {
    shape = emptyMesh();
    for (const child of part.parts) append(shape, make(child, run));
  }
  let spots: Placement[] = [{}];
  if (part.repeat) {
    const { count, step, turn = 0, grow = 1 } = part.repeat;
    spots = Array.from({ length: count }, (_, k) => ({ at: [step[0] * k, step[1] * k, step[2] * k] as Vec3, turn: turn * k, size: grow ** k }));
  }
  const copies = emptyMesh();
  const lay = (spot: Placement, then?: Placement) => {
    run.instances += 1;
    run.triangles += triangleCount(shape);
    if (run.instances > LIMITS.instances || run.triangles > LIMITS.triangles * 1.5) fail("FORGE_TOO_HEAVY");
    if (!then) return append(copies, shape, spot);
    const one = emptyMesh();
    append(one, shape, spot);
    append(copies, one, then);
  };
  for (const spot of spots) {
    if (part.around) {
      for (let k = 0; k < part.around.count; k += 1) {
        const angle = (360 * k) / part.around.count;
        const rad = (angle * Math.PI) / 180;
        lay(spot, { at: [Math.cos(rad) * part.around.radius, 0, Math.sin(rad) * part.around.radius], turn: -angle });
      }
    } else if (part.scatter) {
      const [low, high] = part.scatter.size ?? [0.8, 1.2];
      for (let k = 0; k < part.scatter.count; k += 1) lay(spot, { at: [(run.next() - 0.5) * part.scatter.spread[0], 0, (run.next() - 0.5) * part.scatter.spread[1]], turn: run.next() * 360, size: low + (high - low) * run.next() });
    } else lay(spot);
  }
  // A mirror adds a second, flipped copy of everything laid so far.
  if (part.mirror) append(copies, { positions: [...copies.positions], indices: [...copies.indices], materials: [...copies.materials] }, {}, part.mirror);
  const placed = emptyMesh();
  append(placed, copies, { at: part.at, turn: part.turn, tip: part.tip, roll: part.roll, size: part.size });
  return placed;
}

export type Built = { mesh: Mesh; triangles: number; radius: number; height: number; isletRadius: number };

/** Makes the thing. The same recipe and the same hand always make the same mesh. */
export function buildRecipe(recipe: Recipe, hand: Hand): Built {
  const run: Run = { hand, next: rng(recipe.seed), instances: 0, triangles: 0 };
  const mesh = emptyMesh();
  for (const part of recipe.parts) append(mesh, make(part, run));
  const box = bounds(mesh);
  const radius = Math.max(Math.abs(box.min[0]), Math.abs(box.max[0]), Math.abs(box.min[2]), Math.abs(box.max[2]));
  if (radius > LIMITS.radius || box.max[1] > LIMITS.height || box.min[1] < -LIMITS.below) fail("FORGE_TOO_BIG");
  const isletRadius = Math.max(3, radius * 1.1 + 1);
  if (recipe.islet) append(mesh, islet(isletRadius, hand, recipe.seed));
  const triangles = triangleCount(mesh);
  if (triangles > LIMITS.triangles) fail("FORGE_TOO_HEAVY");
  if (triangles < 1 || !soundMesh(mesh)) fail("FORGE_BROKEN");
  return { mesh, triangles, radius, height: box.max[1], isletRadius };
}
