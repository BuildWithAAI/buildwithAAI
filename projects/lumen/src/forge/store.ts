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
import { CHUNK_WORLD } from "../world/chunkMath";
import { isHers } from "../world/land";
import { append, encodeMesh, turnAbout, type Vec3 } from "./mesh";
import { causeway } from "./shape";
import { buildRecipe, cleanRecipe, type Built, type Recipe } from "./recipe";
import { renderMesh } from "./view";

/**
 * What she has built, and where it stands.
 *
 * Her island is her sanctuary and is left as it is. What she raises with the forge stands around it,
 * each build on its own floating islet, on a lattice of sites far enough apart that none can touch
 * another or the island. Every version of every build is kept, so any change can be undone.
 *
 * Her land grows outward and stays in one piece. A new build may only go on a site beside her island
 * or beside something she has already built, and it is joined to that neighbour by a path. Nothing she
 * raises stands alone, and nothing may be taken down if that would cut other builds off from her island.
 * Every site is on land she holds.
 */

export const FORGE = { standing: 48, perDay: 4, everyMs: 3 * 3_600_000, /** Metres between neighbouring sites. */ site: 90 } as const;
/** Where a path meets her island: this far from its centre, at this height. */
export const SHORE = { radius: 58, height: 0.9 } as const;

export type ForgeBuild = { id: string; name: string; kind: string; version: number; status: "standing" | "removed"; /** Its place on the lattice of sites. */ si: number; sj: number; /** What its path leads back to: "island", or the build it grew from. */ parent: string; x: number; z: number; yaw: number; lift: number; triangles: number; radius: number; height: number; by: "zoora" | "owner"; createdAt: number; updatedAt: number };

export function ensureForge(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS forge_builds (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, recipe TEXT NOT NULL, version INTEGER NOT NULL, status TEXT NOT NULL,
      si INTEGER NOT NULL, sj INTEGER NOT NULL, parent TEXT NOT NULL, x REAL NOT NULL, z REAL NOT NULL, yaw REAL NOT NULL, lift REAL NOT NULL, triangles INTEGER NOT NULL,
      radius REAL NOT NULL, height REAL NOT NULL, made_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS forge_versions (build_id TEXT NOT NULL, version INTEGER NOT NULL, recipe TEXT NOT NULL, at_ms INTEGER NOT NULL, PRIMARY KEY(build_id, version));
  `);
}

/** The lattice cells her island itself covers. Nothing is built there. */
export function islandCell(i: number, j: number): boolean {
  return Math.abs(i) + Math.abs(j) <= 1;
}

export function siteAt(i: number, j: number): { x: number; z: number; yaw: number } {
  const x = i * FORGE.site;
  const z = j * FORGE.site;
  return { x, z, yaw: -Math.atan2(z, x) };
}

const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

type Row = { id: string; name: string; kind: string; recipe: string; version: number; status: "standing" | "removed"; si: number; sj: number; parent: string; x: number; z: number; yaw: number; lift: number; triangles: number; radius: number; height: number; made_by: "zoora" | "owner"; created_at: number; updated_at: number };
const shape = (row: Row): ForgeBuild => ({ id: row.id, name: row.name, kind: row.kind, version: Number(row.version), status: row.status, si: Number(row.si), sj: Number(row.sj), parent: row.parent, x: row.x, z: row.z, yaw: row.yaw, lift: row.lift, triangles: Number(row.triangles), radius: row.radius, height: row.height, by: row.made_by, createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) });

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

/**
 * The next place she may build: a free site beside her island or beside a standing build, on land she
 * holds, nearest home first. `parent` is the neighbour its path will lead to.
 */
export function nextSite(db: DatabaseSync): { i: number; j: number; parent: string } | null {
  const builds = standing(db);
  const taken = new Map(builds.map((build) => [`${build.si},${build.sj}`, build.id]));
  let best: { i: number; j: number; parent: string; rank: number } | null = null;
  const offer = (i: number, j: number) => {
    if (islandCell(i, j) || taken.has(`${i},${j}`)) return;
    const spot = siteAt(i, j);
    if (!isHers(db, Math.round(spot.x / CHUNK_WORLD), Math.round(spot.z / CHUNK_WORLD))) return;
    // Its path goes to the island when it can, otherwise to the neighbour nearest home.
    let parent: string | null = null;
    let near = Infinity;
    for (const [di, dj] of SIDES) {
      const [ni, nj] = [i + di, j + dj];
      const distance = Math.hypot(ni, nj);
      const who = islandCell(ni, nj) ? "island" : taken.get(`${ni},${nj}`);
      if (who && distance < near) {
        near = distance;
        parent = who;
      }
    }
    if (!parent) return;
    const rank = Math.hypot(i, j) + (Math.atan2(j, i) + Math.PI) / 1000;
    if (!best || rank < best.rank) best = { i, j, parent, rank };
  };
  for (let i = -2; i <= 2; i += 1) for (let j = -2; j <= 2; j += 1) offer(i, j);
  for (const build of builds) for (const [di, dj] of SIDES) offer(build.si + di, build.sj + dj);
  const found = best as { i: number; j: number; parent: string } | null;
  return found ? { i: found.i, j: found.j, parent: found.parent } : null;
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
  const site = nextSite(db);
  if (!site) throw new Error("FORGE_NO_LAND");
  const spot = siteAt(site.i, site.j);
  const text = JSON.stringify(recipe);
  const id = `forge-${createHash("sha256").update(`${text}:${now}:${site.i}:${site.j}`).digest("hex").slice(0, 10)}`;
  db.prepare("INSERT INTO forge_builds(id, name, kind, recipe, version, status, si, sj, parent, x, z, yaw, lift, triangles, radius, height, made_by, created_at, updated_at) VALUES(?, ?, ?, ?, 1, 'standing', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(id, recipe.name, kind.replace(/[^a-z-]/g, "").slice(0, 20) || "own", text, site.i, site.j, site.parent, spot.x, spot.z, spot.yaw, liftOf(built), built.triangles, built.isletRadius, built.height, by, now, now);
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

/**
 * Takes a build down. Refused if any other build would be left with no way back to her island. A build
 * whose path led to this one is given a path to another neighbour instead.
 */
export function remove(db: DatabaseSync, id: string, now: number): ForgeBuild {
  const current = getBuild(db, id);
  if (!current || current.status !== "standing") throw new Error("FORGE_UNKNOWN");
  const rest = standing(db).filter((build) => build.id !== id);
  const at = new Map(rest.map((build) => [`${build.si},${build.sj}`, build]));
  // Walk outward from the island over what would be left, noting which neighbour each build is reached from.
  const reached = new Map<string, string>();
  let edge = rest.filter((build) => SIDES.some(([di, dj]) => islandCell(build.si + di, build.sj + dj)));
  for (const build of edge) reached.set(build.id, "island");
  while (edge.length) {
    const next: ForgeBuild[] = [];
    for (const build of edge) {
      for (const [di, dj] of SIDES) {
        const neighbour = at.get(`${build.si + di},${build.sj + dj}`);
        if (neighbour && !reached.has(neighbour.id)) {
          reached.set(neighbour.id, build.id);
          next.push(neighbour);
        }
      }
    }
    edge = next;
  }
  if (reached.size !== rest.length) throw new Error("FORGE_HOLDS_PATH");
  for (const build of rest) if (build.parent === id) db.prepare("UPDATE forge_builds SET parent = ?, updated_at = ? WHERE id = ?").run(reached.get(build.id)!, now, build.id);
  db.prepare("UPDATE forge_builds SET status = 'removed', updated_at = ? WHERE id = ?").run(now, id);
  return getBuild(db, id)!;
}

/** Where a build's path ends: the rim of the neighbour it leads to, or her island's shore. */
function pathEnd(db: DatabaseSync, build: ForgeBuild): { to: Vec3; stamp: string } {
  const toward = (cx: number, cz: number, reach: number, height: number): Vec3 => {
    const d = Math.hypot(build.x - cx, build.z - cz) || 1;
    return [cx + ((build.x - cx) / d) * reach, height, cz + ((build.z - cz) / d) * reach];
  };
  const parent = build.parent === "island" ? null : getBuild(db, build.parent);
  if (!parent || parent.status !== "standing") return { to: toward(0, 0, SHORE.radius, SHORE.height), stamp: "island" };
  return { to: toward(parent.x, parent.z, parent.radius * 0.94, parent.lift + 0.1), stamp: `${parent.id}.${parent.version}` };
}

/** Changes whenever the build or the neighbour its path leads to changes, so the world knows to fetch it again. */
export function revOf(db: DatabaseSync, build: ForgeBuild): string {
  return `${build.version}-${pathEnd(db, build).stamp}`;
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

/** The build as bytes for the world's renderer, with its path back toward her island. */
export function meshBytes(db: DatabaseSync, id: string): Buffer | null {
  const build = getBuild(db, id);
  if (!build || build.status !== "standing") return null;
  return keep(`mesh:${id}:${revOf(db, build)}`, () => {
    const { mesh } = builtOf(db, id)!.built;
    const end = pathEnd(db, build).to;
    // The path is worked out in the world and then turned into the build's own frame, where its top is height 0.
    const local = (p: Vec3): Vec3 => turnAbout([p[0] - build.x, p[1] - build.lift, p[2] - build.z], [0, 1, 0], -build.yaw);
    const d = Math.hypot(end[0] - build.x, end[2] - build.z) || 1;
    const start: Vec3 = [build.x + ((end[0] - build.x) / d) * build.radius * 0.94, build.lift + 0.1, build.z + ((end[2] - build.z) / d) * build.radius * 0.94];
    append(mesh, causeway(local(start), local(end), herHand()));
    return encodeMesh(mesh);
  });
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
