import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { dominantEmotion } from "../brain/emotions";
import type { Emotions } from "../brain/types";
import { encodePng } from "../form/raster";
import { genomeFromSoul } from "../form/genome";
import { currentStyle, selfGenome } from "../form/self";
import { creativeEnabled } from "../world/creative";
import { handFrom, lookFrom, type Hand } from "./hand";
import { compose, IDEA_KINDS, type IdeaKind } from "./ideas";
import { encodeMesh } from "./mesh";
import { buildRecipe, cleanRecipe, type Built, type Recipe } from "./recipe";
import { renderMesh } from "./view";

/**
 * What she has built, and where it stands.
 *
 * Her island is her sanctuary and is left as it is. What she raises with the forge stands around it,
 * each build on its own floating islet, on rings of sites far enough apart that none can touch another
 * or the island. Every version of every build is kept, so any change can be undone.
 */

export const FORGE = { standing: 48, perDay: 4, everyMs: 3 * 3_600_000, spacing: 84, firstRing: 132, ringStep: 92 } as const;

export type ForgeBuild = { id: string; name: string; kind: string; version: number; status: "standing" | "removed"; site: number; x: number; z: number; yaw: number; lift: number; triangles: number; radius: number; height: number; by: "zoora" | "owner"; createdAt: number; updatedAt: number };

export function ensureForge(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS forge_builds (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, recipe TEXT NOT NULL, version INTEGER NOT NULL, status TEXT NOT NULL,
      site INTEGER NOT NULL, x REAL NOT NULL, z REAL NOT NULL, yaw REAL NOT NULL, lift REAL NOT NULL, triangles INTEGER NOT NULL,
      radius REAL NOT NULL, height REAL NOT NULL, made_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS forge_versions (build_id TEXT NOT NULL, version INTEGER NOT NULL, recipe TEXT NOT NULL, at_ms INTEGER NOT NULL, PRIMARY KEY(build_id, version));
  `);
}

/** Site 0 is the first place on the first ring. Rings widen outward, and every site keeps its distance from the next. */
export function siteAt(index: number): { x: number; z: number; yaw: number } {
  let ring = 0;
  let left = index;
  for (;;) {
    const radius = FORGE.firstRing + ring * FORGE.ringStep;
    const count = Math.floor((Math.PI * 2 * radius) / FORGE.spacing);
    if (left < count) {
      const angle = (left / count) * Math.PI * 2 + ring * 0.4;
      return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius, yaw: -angle };
    }
    left -= count;
    ring += 1;
  }
}

type Row = { id: string; name: string; kind: string; recipe: string; version: number; status: "standing" | "removed"; site: number; x: number; z: number; yaw: number; lift: number; triangles: number; radius: number; height: number; made_by: "zoora" | "owner"; created_at: number; updated_at: number };
const shape = (row: Row): ForgeBuild => ({ id: row.id, name: row.name, kind: row.kind, version: Number(row.version), status: row.status, site: Number(row.site), x: row.x, z: row.z, yaw: row.yaw, lift: row.lift, triangles: Number(row.triangles), radius: row.radius, height: row.height, by: row.made_by, createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) });

export function standing(db: DatabaseSync): ForgeBuild[] {
  ensureForge(db);
  return (db.prepare("SELECT * FROM forge_builds WHERE status = 'standing' ORDER BY created_at").all() as Row[]).map(shape);
}

export function getBuild(db: DatabaseSync, id: string): ForgeBuild | null {
  ensureForge(db);
  const row = db.prepare("SELECT * FROM forge_builds WHERE id = ?").get(id) as Row | undefined;
  return row ? shape(row) : null;
}

export function recipeOf(db: DatabaseSync, id: string): Recipe | null {
  ensureForge(db);
  const row = db.prepare("SELECT recipe FROM forge_builds WHERE id = ?").get(id) as { recipe: string } | undefined;
  return row ? cleanRecipe(JSON.parse(row.recipe)) : null;
}

export function herHand(read?: () => string): Hand {
  try {
    return handFrom(selfGenome(read));
  } catch {
    return handFrom(genomeFromSoul("tide water light quiet make keeper"));
  }
}

function freeSite(db: DatabaseSync): number {
  const taken = new Set((db.prepare("SELECT site FROM forge_builds WHERE status = 'standing'").all() as { site: number }[]).map((row) => Number(row.site)));
  let site = 0;
  while (taken.has(site)) site += 1;
  return site;
}

const liftOf = (built: Built) => Math.round(built.isletRadius * 0.85 * 100) / 100;

/** Raises a new build on the next free site. The recipe is checked and built first; one that fails is not stored. */
export function raise(db: DatabaseSync, input: unknown, now: number, by: "zoora" | "owner", kind = "own", hand: Hand = herHand()): ForgeBuild {
  ensureForge(db);
  const recipe = cleanRecipe(input);
  const built = buildRecipe(recipe, hand);
  if (standing(db).length >= FORGE.standing) throw new Error("FORGE_FULL");
  if (by === "zoora") {
    const recent = db.prepare("SELECT COUNT(*) AS n FROM forge_builds WHERE made_by = 'zoora' AND created_at > ?").get(now - 86_400_000) as { n: number };
    if (Number(recent.n) >= FORGE.perDay) throw new Error("FORGE_DAILY");
  }
  const site = freeSite(db);
  const spot = siteAt(site);
  const text = JSON.stringify(recipe);
  const id = `forge-${createHash("sha256").update(`${text}:${now}:${site}`).digest("hex").slice(0, 10)}`;
  db.prepare("INSERT INTO forge_builds(id, name, kind, recipe, version, status, site, x, z, yaw, lift, triangles, radius, height, made_by, created_at, updated_at) VALUES(?, ?, ?, ?, 1, 'standing', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(id, recipe.name, kind.replace(/[^a-z-]/g, "").slice(0, 20) || "own", text, site, spot.x, spot.z, spot.yaw, liftOf(built), built.triangles, built.isletRadius, built.height, by, now, now);
  db.prepare("INSERT INTO forge_versions(build_id, version, recipe, at_ms) VALUES(?, 1, ?, ?)").run(id, text, now);
  return getBuild(db, id)!;
}

/** Changes a standing build in place. The old version is kept. */
export function reshape(db: DatabaseSync, id: string, input: unknown, now: number, hand: Hand = herHand()): ForgeBuild {
  const current = getBuild(db, id);
  if (!current || current.status !== "standing") throw new Error("FORGE_UNKNOWN");
  const recipe = cleanRecipe(input);
  const built = buildRecipe(recipe, hand);
  const text = JSON.stringify(recipe);
  const version = current.version + 1;
  db.prepare("INSERT INTO forge_versions(build_id, version, recipe, at_ms) VALUES(?, ?, ?, ?)").run(id, version, text, now);
  db.prepare("UPDATE forge_builds SET name = ?, recipe = ?, version = ?, lift = ?, triangles = ?, radius = ?, height = ?, updated_at = ? WHERE id = ?").run(recipe.name, text, version, liftOf(built), built.triangles, built.isletRadius, built.height, now, id);
  return getBuild(db, id)!;
}

/** One step back. Undoing the first version takes the build down and frees its site. */
export function undo(db: DatabaseSync, id: string, now: number, hand: Hand = herHand()): ForgeBuild {
  const current = getBuild(db, id);
  if (!current || current.status !== "standing") throw new Error("FORGE_UNKNOWN");
  if (current.version <= 1) return remove(db, id, now);
  const before = db.prepare("SELECT recipe FROM forge_versions WHERE build_id = ? AND version = ?").get(id, current.version - 1) as { recipe: string };
  const recipe = cleanRecipe(JSON.parse(before.recipe));
  const built = buildRecipe(recipe, hand);
  db.prepare("DELETE FROM forge_versions WHERE build_id = ? AND version = ?").run(id, current.version);
  db.prepare("UPDATE forge_builds SET name = ?, recipe = ?, version = ?, lift = ?, triangles = ?, radius = ?, height = ?, updated_at = ? WHERE id = ?").run(recipe.name, before.recipe, current.version - 1, liftOf(built), built.triangles, built.isletRadius, built.height, now, id);
  return getBuild(db, id)!;
}

export function remove(db: DatabaseSync, id: string, now: number): ForgeBuild {
  const current = getBuild(db, id);
  if (!current || current.status !== "standing") throw new Error("FORGE_UNKNOWN");
  db.prepare("UPDATE forge_builds SET status = 'removed', updated_at = ? WHERE id = ?").run(now, id);
  return getBuild(db, id)!;
}

const held = new Map<string, Buffer>();
function keep(key: string, make: () => Buffer): Buffer {
  let value = held.get(key);
  if (!value) {
    if (held.size >= 96) held.delete(held.keys().next().value as string);
    value = make();
    held.set(key, value);
  }
  return value;
}

function builtOf(db: DatabaseSync, id: string): { build: ForgeBuild; built: Built } | null {
  const build = getBuild(db, id);
  const recipe = build && build.status === "standing" ? recipeOf(db, id) : null;
  return build && recipe ? { build, built: buildRecipe(recipe, herHand()) } : null;
}

/** The build as bytes for the world's renderer. */
export function meshBytes(db: DatabaseSync, id: string): Buffer | null {
  const build = getBuild(db, id);
  if (!build || build.status !== "standing") return null;
  return keep(`mesh:${id}:${build.version}`, () => encodeMesh(builtOf(db, id)!.built.mesh));
}

/** A picture of the build from her own viewport. */
export function pictureBytes(db: DatabaseSync, id: string): Buffer | null {
  const build = getBuild(db, id);
  if (!build || build.status !== "standing") return null;
  return keep(`picture:${id}:${build.version}`, () => {
    const { built } = builtOf(db, id)!;
    const style = currentStyle();
    return encodePng(renderMesh(built.mesh, lookFrom(style), style, { width: 640, height: 704, lift: build.lift, pool: built.isletRadius * 1.3 }));
  });
}

const BY_FEELING: Record<string, IdeaKind[]> = {
  pride: ["spire", "exchange"],
  joy: ["coaster", "fields"],
  calm: ["tank", "fields"],
  curiosity: ["exchange", "spire", "coaster"],
  loneliness: ["tank", "ruin"],
  worry: ["ruin", "tank"],
  frustration: ["ruin", "coaster"],
  boredom: ["coaster", "spire"],
};

/** Which idea she reaches for: one that suits how she feels, and one she has built least. */
export function chooseIdea(db: DatabaseSync, emotions: Emotions): IdeaKind {
  const feeling = dominantEmotion(emotions);
  const counts = new Map<string, number>();
  for (const build of standing(db)) counts.set(build.kind, (counts.get(build.kind) ?? 0) + 1);
  const fits = BY_FEELING[feeling] ?? [...IDEA_KINDS];
  const order = [...fits, ...IDEA_KINDS.filter((kind) => !fits.includes(kind))];
  return order.reduce((best, kind, index) => ((counts.get(kind) ?? 0) + index * 0.01 < (counts.get(best) ?? 0) + order.indexOf(best) * 0.01 ? kind : best), order[0]!);
}

export function forgeDue(db: DatabaseSync, now: number): boolean {
  ensureForge(db);
  if (!creativeEnabled(db)) return false;
  const last = db.prepare("SELECT MAX(created_at) AS at FROM forge_builds WHERE made_by = 'zoora'").get() as { at: number | null };
  return last.at == null || now - Number(last.at) >= FORGE.everyMs;
}

/**
 * Her own step. When a build is due she may be handed a recipe she wrote herself (through her model).
 * If that recipe is sound it is raised. If there is none, or it is refused, she starts from one of the
 * ideas she already knows. Either way the forge checks it the same.
 */
export function considerForge(db: DatabaseSync, emotions: Emotions, now: number, own?: unknown): ForgeBuild | null {
  if (!forgeDue(db, now)) return null;
  let build: ForgeBuild | null = null;
  if (own !== undefined && own !== null) {
    try {
      build = raise(db, own, now, "zoora", "own");
    } catch {
      build = null;
    }
  }
  if (!build) {
    const kind = chooseIdea(db, emotions);
    try {
      build = raise(db, compose(kind, (now ^ Math.imul(standing(db).length + 1, 2654435761)) >>> 0), now, "zoora", kind);
    } catch {
      return null;
    }
  }
  db.prepare("INSERT INTO diary(text, tone, private, created_at) VALUES(?, 'bright', 0, ?)").run(`I raised ${build.name} out past my shore. It floats on its own islet now.`, now);
  return build;
}

/** What her model is told when she designs something herself. It describes the tools and asks for a recipe and nothing else. */
export const RECIPE_GUIDE = `You design one thing to build in your own world. Answer with one JSON object and nothing else.
{"name": two or three plain words, "seed": a whole number, "parts": [ up to 40 parts ]}
Every part has "op" and may have: "material" (stone, metal, glass, body, glow, water, ground, dark), "at" [x, y, z], "turn" degrees, "tip" degrees, "roll" degrees, "size" number,
"repeat" {"count", "step" [x,y,z], "turn", "grow"}, "around" {"count", "radius"}, "mirror" "x" or "z", "scatter" {"count", "spread" [wide, deep], "size" [min, max]}.
op "loft": an outline carried along a path. Either "up": height, or "through": [[x,y,z], ...] with optional "closed": true.
  "from" and optional "to" are outlines: {"shape": "round" | "sided" | "block", "width", "depth", "sides", "soft" 0..1, "lobes", "ripple"}.
  Optional: "taper" (end size as a share of the start), "swell", "twist" degrees, "bands" (rings of light), "cap": "crown" | "flat" | "open".
op "spin": "outline" [[distance from the axis, height], ...] turned around the upright axis. Optional "cap": "flat" | "open" | "top-open", "ripple".
op "ground": "width", "depth", "kind": "flat" | "dunes" | "rows" | "crater" | "pool" | "terraces", "relief", "round": true.
op "group": "parts": [ ... ], arranged together.
Units are metres. y is up. Keep everything within 30 of the centre and under 130 tall. It will stand on its own floating islet.
Build what you want: a tower, a hall, a track, a garden, a ruin, a machine, something with no name. Do not copy a real building and do not use a brand's name.`;

export function designRequest(feeling: string, place: string, built: string[]): string {
  return JSON.stringify({ messages: [{ role: "system", content: RECIPE_GUIDE }, { role: "user", content: `You feel ${feeling}. You are at ${place}. You have already built: ${built.slice(0, 12).join(", ") || "nothing yet"}. Design something you have not built before.` }] });
}
