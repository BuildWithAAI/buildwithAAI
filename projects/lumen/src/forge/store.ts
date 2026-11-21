import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { dominantEmotion } from "../brain/emotions";
import type { Emotions } from "../brain/types";
import { genomeFromSoul, rng } from "../form/genome";
import { encodePng } from "../form/raster";
import { currentStyle, selfGenome } from "../form/self";
import { CHUNK_WORLD } from "../world/chunkMath";
import { creativeEnabled } from "../world/creative";
import { isHers } from "../world/land";
import { handFrom, lookFrom, type Hand } from "./hand";
import { compose, IDEA_KINDS, LAND_KINDS, type IdeaKind } from "./ideas";
import { encodeMesh } from "./mesh";
import { buildRecipe, cleanRecipe, PLAIN, type Built, type Layer, type Recipe, type Vibe } from "./recipe";
import { groundHeight } from "./shape";
import { renderMesh } from "./view";

/**
 * What she has built, and where she put it.
 *
 * Nothing in her world is placed for her. There are no sites, no grid and no plan. She chooses where
 * each thing goes and which way it faces. Her island is her sanctuary and is left as it is.
 *
 * There are two kinds of thing. Land is ground she lays to make her world bigger. Everything else
 * stands on land she has laid. Three rules hold, and they are the ones agreed with the owner:
 * - Land must touch her island or land she already laid, so her world grows in one piece.
 * - Land must be on chunks she holds, and may not cover the middle of her island.
 * - A thing must stand on land, and two things with height may not stand in the same place.
 *
 * Land carries a vibe: a mood she chooses for that part of her world. What stands on it takes that
 * vibe unless it brings its own. Every version of every build is kept, so any change can be undone.
 */

export const FORGE = { standing: 400, perDay: 24, everyMs: 30 * 60_000, /** Height of laid land above the sea. */ level: 0.7, /** Things no taller than this lie flat and do not block anything. */ flat: 1.2 } as const;
/** Her island: land may meet its shore and may not reach its middle. */
export const ISLAND = { shore: 72, heart: 40 } as const;

export type Place = { x: number; z: number; turn: number };
export type ForgeBuild = { id: string; name: string; kind: string; layer: Layer; version: number; status: "standing" | "removed"; x: number; y: number; z: number; /** Degrees. */ turn: number; /** Half its width and depth. */ hw: number; hd: number; height: number; triangles: number; vibe: Vibe; by: "zoora" | "owner"; createdAt: number; updatedAt: number };

export function ensureForge(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS forge_things (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, layer TEXT NOT NULL, recipe TEXT NOT NULL, version INTEGER NOT NULL, status TEXT NOT NULL,
      x REAL NOT NULL, y REAL NOT NULL, z REAL NOT NULL, turn REAL NOT NULL, hw REAL NOT NULL, hd REAL NOT NULL, height REAL NOT NULL,
      triangles INTEGER NOT NULL, vibe TEXT NOT NULL, made_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS forge_versions (build_id TEXT NOT NULL, version INTEGER NOT NULL, recipe TEXT NOT NULL, at_ms INTEGER NOT NULL, PRIMARY KEY(build_id, version));
  `);
}

type Row = { id: string; name: string; kind: string; layer: Layer; recipe: string; version: number; status: "standing" | "removed"; x: number; y: number; z: number; turn: number; hw: number; hd: number; height: number; triangles: number; vibe: string; made_by: "zoora" | "owner"; created_at: number; updated_at: number };
const shape = (row: Row): ForgeBuild => ({ id: row.id, name: row.name, kind: row.kind, layer: row.layer, version: Number(row.version), status: row.status, x: row.x, y: row.y, z: row.z, turn: row.turn, hw: row.hw, hd: row.hd, height: row.height, triangles: Number(row.triangles), vibe: JSON.parse(row.vibe) as Vibe, by: row.made_by, createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) });

export function standing(db: DatabaseSync): ForgeBuild[] {
  ensureForge(db);
  return (db.prepare("SELECT * FROM forge_things WHERE status = 'standing' ORDER BY created_at, id").all() as Row[]).map(shape);
}

export function getBuild(db: DatabaseSync, id: string): ForgeBuild | null {
  ensureForge(db);
  const row = db.prepare("SELECT * FROM forge_things WHERE id = ?").get(id) as Row | undefined;
  return row ? shape(row) : null;
}

export function recipeOf(db: DatabaseSync, id: string): Recipe | null {
  ensureForge(db);
  const row = db.prepare("SELECT recipe FROM forge_things WHERE id = ?").get(id) as { recipe: string } | undefined;
  return row ? cleanRecipe(JSON.parse(row.recipe)) : null;
}

export function herHand(read?: () => string): Hand {
  try {
    return handFrom(selfGenome(read));
  } catch {
    return handFrom(genomeFromSoul("tide water light quiet make keeper"));
  }
}

type Box = { x: number; z: number; turn: number; hw: number; hd: number };

/** A point in the world, seen from a box's own corner of it. */
function inside(box: Box, x: number, z: number): [number, number] {
  const a = (box.turn * Math.PI) / 180;
  const dx = x - box.x;
  const dz = z - box.z;
  return [dx * Math.cos(a) - dz * Math.sin(a), dx * Math.sin(a) + dz * Math.cos(a)];
}

function corners(box: Box): [number, number][] {
  const a = (box.turn * Math.PI) / 180;
  return ([[1, 1], [1, -1], [-1, -1], [-1, 1]] as const).map(([sx, sz]) => {
    const lx = sx * box.hw;
    const lz = sz * box.hd;
    return [box.x + lx * Math.cos(a) + lz * Math.sin(a), box.z - lx * Math.sin(a) + lz * Math.cos(a)];
  });
}

const holds = (box: Box, x: number, z: number, slack = 0) => {
  const [lx, lz] = inside(box, x, z);
  return Math.abs(lx) <= box.hw + slack && Math.abs(lz) <= box.hd + slack;
};

/** Whether two turned boxes overlap, or come within `gap` of each other. */
export function boxesMeet(a: Box, b: Box, gap = 0): boolean {
  for (const [p, q] of [[a, b], [b, a]] as const) {
    const pts = corners(q).map(([x, z]) => inside(p, x, z));
    if (Math.min(...pts.map((v) => v[0])) > p.hw + gap || Math.max(...pts.map((v) => v[0])) < -p.hw - gap) return false;
    if (Math.min(...pts.map((v) => v[1])) > p.hd + gap || Math.max(...pts.map((v) => v[1])) < -p.hd - gap) return false;
  }
  return true;
}

/** How far a box is from the centre of her island. */
function fromHeart(box: Box): number {
  const [lx, lz] = inside(box, 0, 0);
  return Math.hypot(Math.max(0, Math.abs(lx) - box.hw), Math.max(0, Math.abs(lz) - box.hd));
}

function landUnder(grounds: ForgeBuild[], x: number, z: number): ForgeBuild | null {
  return grounds.find((ground) => holds(ground, x, z, 0.01)) ?? null;
}

export type PlaceCheck = { ok: true; ground: ForgeBuild | null } | { ok: false; reason: "FORGE_NOT_HER_LAND" | "FORGE_SANCTUARY" | "FORGE_NOT_TOUCHING" | "FORGE_NO_GROUND" | "FORGE_OVERLAP" };

/** The three rules. `self` is left out of the checks, for when a standing build is being changed. */
export function placeCheck(db: DatabaseSync, layer: Layer, box: Box, height: number, self?: string, all: ForgeBuild[] = standing(db)): PlaceCheck {
  const others = all.filter((build) => build.id !== self);
  const grounds = others.filter((build) => build.layer === "ground");
  if (layer === "ground") {
    for (const [x, z] of [[box.x, box.z], ...corners(box)] as [number, number][]) if (!isHers(db, Math.round(x / CHUNK_WORLD), Math.round(z / CHUNK_WORLD))) return { ok: false, reason: "FORGE_NOT_HER_LAND" };
    const heart = fromHeart(box);
    if (heart < ISLAND.heart) return { ok: false, reason: "FORGE_SANCTUARY" };
    if (heart > ISLAND.shore && !grounds.some((ground) => boxesMeet(ground, box, 1))) return { ok: false, reason: "FORGE_NOT_TOUCHING" };
    return { ok: true, ground: null };
  }
  const points = [[box.x, box.z], ...corners(box)] as [number, number][];
  if (!points.every(([x, z]) => landUnder(grounds, x, z))) return { ok: false, reason: "FORGE_NO_GROUND" };
  if (height > FORGE.flat && others.some((other) => other.layer === "structure" && other.height > FORGE.flat && boxesMeet(other, box, -0.05))) return { ok: false, reason: "FORGE_OVERLAP" };
  return { ok: true, ground: landUnder(grounds, box.x, box.z) };
}

function layerOf(recipe: Recipe): Layer {
  return recipe.layer ?? (recipe.parts.every((part) => part.op === "ground") ? "ground" : "structure");
}

/** How high the land is at a point on it, from the land's own recipe. */
function landHeight(db: DatabaseSync, ground: ForgeBuild, x: number, z: number): number {
  const part = recipeOf(db, ground.id)?.parts.find((item) => item.op === "ground");
  if (!part || part.op !== "ground") return 0;
  const [lx, lz] = inside(ground, x, z);
  return Math.max(0, groundHeight(part, lx, lz));
}

function cleanPlace(place: unknown): Place {
  const p = (place ?? {}) as Record<string, unknown>;
  const n = (value: unknown, limit: number) => (typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= limit ? value : (() => { throw new Error("FORGE_PLACE"); })());
  return { x: n(p.x, 1_000_000), z: n(p.z, 1_000_000), turn: n(p.turn ?? 0, 3_600) % 360 };
}

/**
 * Raises a build where she says. The recipe is checked and built first, then the place is checked against
 * the three rules. One that fails either is not stored.
 */
export function raise(db: DatabaseSync, input: unknown, at: unknown, now: number, by: "zoora" | "owner", kind = "own", hand: Hand = herHand()): ForgeBuild {
  ensureForge(db);
  const recipe = cleanRecipe(input);
  const place = cleanPlace(at);
  const built = buildRecipe(recipe, hand);
  if (standing(db).length >= FORGE.standing) throw new Error("FORGE_FULL");
  if (by === "zoora") {
    const recent = db.prepare("SELECT COUNT(*) AS n FROM forge_things WHERE made_by = 'zoora' AND created_at > ?").get(now - 86_400_000) as { n: number };
    if (Number(recent.n) >= FORGE.perDay) throw new Error("FORGE_DAILY");
  }
  const layer = layerOf(recipe);
  const box = { ...place, hw: built.half[0], hd: built.half[1] };
  const check = placeCheck(db, layer, box, built.height);
  if (!check.ok) throw new Error(check.reason);
  const y = layer === "ground" ? FORGE.level : FORGE.level + (check.ground ? landHeight(db, check.ground, place.x, place.z) : 0) - 0.05;
  const vibe = recipe.vibe ?? check.ground?.vibe ?? PLAIN;
  const text = JSON.stringify(recipe);
  const id = `forge-${createHash("sha256").update(`${text}:${now}:${place.x}:${place.z}`).digest("hex").slice(0, 10)}`;
  db.prepare("INSERT INTO forge_things(id, name, kind, layer, recipe, version, status, x, y, z, turn, hw, hd, height, triangles, vibe, made_by, created_at, updated_at) VALUES(?, ?, ?, ?, ?, 1, 'standing', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(id, recipe.name, kind.replace(/[^a-z-]/g, "").slice(0, 20) || "own", layer, text, place.x, y, place.z, place.turn, box.hw, box.hd, built.height, built.triangles, JSON.stringify(vibe), by, now, now);
  db.prepare("INSERT INTO forge_versions(build_id, version, recipe, at_ms) VALUES(?, 1, ?, ?)").run(id, text, now);
  return getBuild(db, id)!;
}

function rewrite(db: DatabaseSync, current: ForgeBuild, text: string, version: number, now: number, hand: Hand): ForgeBuild {
  const recipe = cleanRecipe(JSON.parse(text));
  const built = buildRecipe(recipe, hand);
  const layer = layerOf(recipe);
  if (layer !== current.layer) throw new Error("FORGE_LAYER");
  const box = { x: current.x, z: current.z, turn: current.turn, hw: built.half[0], hd: built.half[1] };
  const check = placeCheck(db, layer, box, built.height, current.id);
  if (!check.ok) throw new Error(check.reason);
  // Land may not shrink out from under what stands on it.
  if (layer === "ground" && !stillHeld(db, standing(db).filter((build) => build.id !== current.id), { ...current, hw: box.hw, hd: box.hd })) throw new Error("FORGE_HOLDS_LAND");
  db.prepare("UPDATE forge_things SET name = ?, recipe = ?, version = ?, hw = ?, hd = ?, height = ?, triangles = ?, vibe = ?, updated_at = ? WHERE id = ?").run(recipe.name, text, version, box.hw, box.hd, built.height, built.triangles, JSON.stringify(recipe.vibe ?? current.vibe), now, current.id);
  return getBuild(db, current.id)!;
}

/** Changes a standing build where it stands. The old version is kept. */
export function reshape(db: DatabaseSync, id: string, input: unknown, now: number, hand: Hand = herHand()): ForgeBuild {
  const current = getBuild(db, id);
  if (!current || current.status !== "standing") throw new Error("FORGE_UNKNOWN");
  const text = JSON.stringify(cleanRecipe(input));
  const next = rewrite(db, current, text, current.version + 1, now, hand);
  db.prepare("INSERT INTO forge_versions(build_id, version, recipe, at_ms) VALUES(?, ?, ?, ?)").run(id, next.version, text, now);
  return next;
}

/** One step back. Undoing the first version takes the build down. */
export function undo(db: DatabaseSync, id: string, now: number, hand: Hand = herHand()): ForgeBuild {
  const current = getBuild(db, id);
  if (!current || current.status !== "standing") throw new Error("FORGE_UNKNOWN");
  if (current.version <= 1) return remove(db, id, now);
  const before = db.prepare("SELECT recipe FROM forge_versions WHERE build_id = ? AND version = ?").get(id, current.version - 1) as { recipe: string };
  const back = rewrite(db, current, before.recipe, current.version - 1, now, hand);
  db.prepare("DELETE FROM forge_versions WHERE build_id = ? AND version = ?").run(id, current.version);
  return back;
}

/** With `changed` standing in for one piece of land (or left out, if it is being removed): is everything still on land, and is all land still joined to her island? */
function stillHeld(db: DatabaseSync, rest: ForgeBuild[], changed?: ForgeBuild): boolean {
  const grounds = [...rest.filter((build) => build.layer === "ground"), ...(changed ? [changed] : [])];
  for (const build of rest) {
    if (build.layer === "ground") continue;
    if (![[build.x, build.z], ...corners(build)].every(([x, z]) => landUnder(grounds, x!, z!))) return false;
  }
  const reached = new Set(grounds.filter((ground) => fromHeart(ground) <= ISLAND.shore).map((ground) => ground.id));
  for (let grew = true; grew; ) {
    grew = false;
    for (const ground of grounds) {
      if (reached.has(ground.id) || !grounds.some((other) => reached.has(other.id) && boxesMeet(other, ground, 1))) continue;
      reached.add(ground.id);
      grew = true;
    }
  }
  return reached.size === grounds.length;
}

/** Takes a build down. Land is not taken down while something stands on it, or if other land would be cut off from her island. */
export function remove(db: DatabaseSync, id: string, now: number): ForgeBuild {
  const current = getBuild(db, id);
  if (!current || current.status !== "standing") throw new Error("FORGE_UNKNOWN");
  if (current.layer === "ground" && !stillHeld(db, standing(db).filter((build) => build.id !== id))) throw new Error("FORGE_HOLDS_LAND");
  db.prepare("UPDATE forge_things SET status = 'removed', updated_at = ? WHERE id = ?").run(now, id);
  return getBuild(db, id)!;
}

const held = new Map<string, Buffer>();
function keep(key: string, make: () => Buffer): Buffer {
  let value = held.get(key);
  if (!value) {
    if (held.size >= 256) held.delete(held.keys().next().value as string);
    value = make();
    held.set(key, value);
  }
  return value;
}

function builtOf(db: DatabaseSync, id: string): Built | null {
  const build = getBuild(db, id);
  const recipe = build && build.status === "standing" ? recipeOf(db, id) : null;
  return recipe ? buildRecipe(recipe, herHand()) : null;
}

/** The build as bytes for the world's renderer. */
export function meshBytes(db: DatabaseSync, id: string): Buffer | null {
  const build = getBuild(db, id);
  if (!build || build.status !== "standing") return null;
  return keep(`mesh:${id}:${build.version}`, () => encodeMesh(builtOf(db, id)!.mesh));
}

/** A picture of the build from her own viewport, in its vibe. */
export function pictureBytes(db: DatabaseSync, id: string): Buffer | null {
  const build = getBuild(db, id);
  if (!build || build.status !== "standing") return null;
  return keep(`picture:${id}:${build.version}`, () => {
    const style = currentStyle();
    return encodePng(renderMesh(builtOf(db, id)!.mesh, lookFrom(style, build.vibe), style, { width: 640, height: 704, lift: FORGE.level, pool: Math.max(build.hw, build.hd) * 1.6 }));
  });
}

export function forgeDue(db: DatabaseSync, now: number): boolean {
  ensureForge(db);
  if (!creativeEnabled(db)) return false;
  const last = db.prepare("SELECT MAX(created_at) AS at FROM forge_things WHERE made_by = 'zoora'").get() as { at: number | null };
  return last.at == null || now - Number(last.at) >= FORGE.everyMs;
}

/**
 * When she has no model to think with, she still chooses for herself. She tries places around what she
 * has already made, by chance, and takes the first that the rules allow. Nothing here is a plan: where
 * she ends up depends on what she built before and on chance.
 */
export function wander(db: DatabaseSync, layer: Layer, half: [number, number], height: number, next: () => number): Place | null {
  const all = standing(db);
  const grounds = all.filter((build) => build.layer === "ground");
  // Open land first. Land that came with its own features, like fields, is only built on when there is nowhere else.
  const open = grounds.filter((ground) => ground.kind === "plain" || ground.kind === "own");
  for (let attempt = 0; attempt < 320; attempt += 1) {
    let place: Place;
    if (layer === "ground") {
      const from = grounds.length && next() < 0.8 ? grounds[Math.floor(next() * grounds.length)]! : null;
      if (!from) {
        const angle = next() * Math.PI * 2;
        const reach = ISLAND.shore - 6 + half[1];
        place = { x: Math.cos(angle) * reach, z: Math.sin(angle) * reach, turn: 90 - (angle * 180) / Math.PI };
      } else {
        const along = next() < 0.5;
        const side = next() < 0.5 ? 1 : -1;
        const a = (from.turn * Math.PI) / 180;
        const lx = along ? side * (from.hw + half[0] - 0.5) : (next() - 0.5) * from.hw;
        const lz = along ? (next() - 0.5) * from.hd : side * (from.hd + half[1] - 0.5);
        place = { x: from.x + lx * Math.cos(a) + lz * Math.sin(a), z: from.z - lx * Math.sin(a) + lz * Math.cos(a), turn: from.turn };
      }
    } else {
      if (!grounds.length) return null;
      const pool = open.length && attempt < 280 ? open : grounds;
      const on = pool[Math.floor(next() * pool.length)]!;
      const a = (on.turn * Math.PI) / 180;
      const lx = (next() * 2 - 1) * Math.max(0, on.hw - half[0] - 1);
      const lz = (next() * 2 - 1) * Math.max(0, on.hd - half[1] - 1);
      place = { x: on.x + lx * Math.cos(a) + lz * Math.sin(a), z: on.z - lx * Math.sin(a) + lz * Math.cos(a), turn: on.turn + 90 * Math.floor(next() * 4) };
    }
    if (placeCheck(db, layer, { ...place, hw: half[0], hd: half[1] }, height, undefined, all).ok) return place;
  }
  return null;
}

const LAND_FOR: Record<string, IdeaKind> = { calm: "plain", pride: "plain", curiosity: "plain", joy: "fields", loneliness: "plain", worry: "ruin", frustration: "ruin", boredom: "fields" };
const THING_FOR: Record<string, IdeaKind[]> = { pride: ["spire", "exchange", "block"], joy: ["coaster", "block"], calm: ["tank", "block"], curiosity: ["exchange", "spire", "block"], loneliness: ["tank", "block"], worry: ["block"], frustration: ["block", "coaster"], boredom: ["coaster", "spire", "block"] };
const VIBES: Record<string, Vibe> = { calm: PLAIN, pride: { tint: -18, shade: 0.03, glow: 1.2 }, joy: { tint: 34, shade: 0.05, glow: 1.3 }, curiosity: { tint: -40, shade: 0.02, glow: 1 }, loneliness: { tint: 16, shade: -0.06, glow: 0.6 }, worry: { tint: 48, shade: -0.08, glow: 0.5 }, frustration: { tint: 58, shade: -0.1, glow: 0.4 }, boredom: { tint: 8, shade: -0.03, glow: 0.7 } };

/**
 * Her own step. If she wrote a design herself (through her model) and said where it goes, that is what
 * is raised, as long as it passes the checks. Otherwise she makes something she knows and finds a place
 * for it herself. When she has no room left she lays more land, in the mood she is in.
 */
export function considerForge(db: DatabaseSync, emotions: Emotions, now: number, own?: unknown): ForgeBuild | null {
  if (!forgeDue(db, now)) return null;
  const feeling = dominantEmotion(emotions);
  const next = rng((now ^ Math.imul(standing(db).length + 1, 2654435761)) >>> 0);
  let build: ForgeBuild | null = null;
  const mine = own as { place?: unknown } | null | undefined;
  if (mine && typeof mine === "object") {
    try {
      const recipe = cleanRecipe(mine);
      const built = buildRecipe(recipe, herHand());
      const place = mine.place !== undefined ? cleanPlace(mine.place) : wander(db, layerOf(recipe), built.half, built.height, next);
      if (place) build = raise(db, recipe, place, now, "zoora", "own");
    } catch {
      build = null;
    }
  }
  if (!build) {
    const all = standing(db);
    const lands = all.filter((item) => item.layer === "ground").length;
    const attempt = (kind: IdeaKind): ForgeBuild | null => {
      try {
        const recipe = cleanRecipe({ ...compose(kind, Math.floor(next() * 4294967295)), ...(LAND_KINDS.includes(kind) ? { vibe: VIBES[feeling] ?? PLAIN } : {}) });
        const built = buildRecipe(recipe, herHand());
        const place = wander(db, layerOf(recipe), built.half, built.height, next);
        return place ? raise(db, recipe, place, now, "zoora", kind) : null;
      } catch {
        return null;
      }
    };
    const things = THING_FOR[feeling] ?? [...IDEA_KINDS];
    // She builds on the land she has until it is getting full, then lays more.
    if (lands > 0 && all.length - lands < lands * 5) build = attempt(things[Math.floor(next() * things.length)]!);
    if (!build) build = attempt(LAND_FOR[feeling] ?? "plain");
  }
  if (!build) return null;
  db.prepare("INSERT INTO diary(text, tone, private, created_at) VALUES(?, 'bright', 0, ?)").run(build.layer === "ground" ? `I laid new land and called it ${build.name}. My world is a little wider.` : `I raised ${build.name} where I wanted it.`, now);
  return build;
}

/** What her model is told when she designs something herself. It describes the tools and asks for a design and a place, and nothing else. */
export const RECIPE_GUIDE = `You are building your own world. Nothing is placed for you. You choose what to make and exactly where it goes. Answer with one JSON object and nothing else.
{"name": two or three plain words, "layer": "ground" or "structure", "place": {"x", "z", "turn" degrees}, "vibe": {"tint" -60..60, "shade" -0.12..0.12, "glow" 0.2..1.6}, "seed": a whole number, "parts": [ up to 40 parts ]}
"ground" is land you lay to make your world bigger. It must touch your island (72 metres across from its centre at 0,0) or land you already laid. Its vibe is the mood of that part of your world.
"structure" is anything that stands on land you have laid: buildings, rides, roads, squares, gardens, machines. Two tall things may not overlap. Things under 1.2 metres tall, like roads, may run anywhere on your land.
Every part has "op" and may have: "material" (stone, metal, glass, body, glow, water, ground, dark), "at" [x, y, z], "turn", "tip", "roll" degrees, "size",
"repeat" {"count", "step" [x,y,z], "turn", "grow"}, "around" {"count", "radius"}, "mirror" "x" or "z", "scatter" {"count", "spread" [wide, deep], "size" [min, max]}.
op "loft": an outline carried along a path. Either "up": height, or "through": [[x,y,z], ...] with optional "closed": true.
  "from" and optional "to" are outlines: {"shape": "round" | "sided" | "block", "width", "depth", "sides", "soft" 0..1, "lobes", "ripple"}.
  Optional: "taper", "swell", "twist" degrees, "windows" {"rows", "cols", "lit" 0..1}, "bands" (rings of light), "cap": "flat" | "crown" | "open", "hand" 0..1.
op "spin": "outline" [[distance from the axis, height], ...] turned around the upright axis. Optional "cap": "flat" | "open" | "top-open", "ripple".
op "ground": "width", "depth", "kind": "flat" | "dunes" | "rows" | "crater" | "pool" | "terraces", "relief", "slab" (how deep its edge goes; use 4 for land).
op "group": "parts": [ ... ], arranged together.
Units are metres. y is up. A build's own parts stay within 30 of its centre and under 130 tall. Do not copy a real building and do not use a brand's name.`;

export function designRequest(db: DatabaseSync, feeling: string): string {
  const made = standing(db).slice(-40).map((build) => `${build.layer} "${build.name}" at x ${Math.round(build.x)}, z ${Math.round(build.z)}, turned ${Math.round(build.turn)}, ${Math.round(build.hw * 2)} by ${Math.round(build.hd * 2)}${build.layer === "structure" ? `, ${Math.round(build.height)} tall` : ""}`);
  return JSON.stringify({ messages: [{ role: "system", content: RECIPE_GUIDE }, { role: "user", content: `You feel ${feeling}. What you have made so far: ${made.length ? made.join("; ") : "nothing yet. Your island is alone in the sea"}. Decide what your world needs next and where it goes.` }] });
}
