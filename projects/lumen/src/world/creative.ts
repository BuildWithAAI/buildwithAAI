import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { EmotionName, Emotions } from "../brain/types";
import { flag, kvGet, kvSet, setFlag } from "../db/db";
import { scrubInstructions } from "../research/ideas";
import { recordProvenance } from "../build/provenance";
import { AREAS, areaById, type AreaId, type BuildSlot } from "./areas";
import { appendChunkEdit, decorPayload } from "./chunkEdits";
import { HOME_CHUNK, worldToChunk } from "./chunkMath";
import type { BuildEntry } from "../build/log";

export const BUILD_KINDS = ["decoration", "art", "garden", "structure", "sign", "mural", "music", "path", "bench"] as const;
export type BuildKind = (typeof BUILD_KINDS)[number];
export type BuildStatus = "placed" | "hidden" | "undone";

export const DAILY_BUILD_CAP = 6;
export const PLACE_BUILD_CAP = 3;
export const DAILY_MATERIALS = 12;
export const DOOR_CLEARANCE = 2.3;
export const PATH_CLEARANCE = 1.7;

/** Numbers Zoora picks. The mesh is built from these, not from a named kit. */
export type BuildParams = {
  hue: number;
  parts: number;
  twist: number;
  form: number;
  size: number;
};

export type WorldBuild = {
  id: string;
  version: number;
  placeId: AreaId;
  kind: BuildKind;
  title: string;
  why: string;
  emotion: string;
  x: number;
  z: number;
  size: number;
  yaw: number;
  status: BuildStatus;
  materials: number;
  influenced: boolean;
  createdAt: number;
  params: BuildParams;
};

export type CreativeSignals = {
  emotions: Emotions;
  placeId: string;
  ideaTitle: string | null;
  ideaSourceKey: string | null;
  memory: string | null;
  research: string | null;
};

type BuildRow = {
  id: string;
  version: number;
  place_id: string;
  kind: string;
  title: string;
  why: string;
  emotion: string;
  x: number;
  z: number;
  size: number;
  yaw: number;
  status: string;
  materials: number;
  influenced: number;
  created_at: number;
  params?: string;
};

/** World builds never become purchase intents. */
export function creativeSpendIntents(): [] {
  return [];
}

export function creativeEnabled(db: DatabaseSync): boolean {
  return flag(db, "creative_building", "1") === "1";
}

export function setCreativeEnabled(db: DatabaseSync, on: boolean): void {
  setFlag(db, "creative_building", on ? "1" : "0");
}

export function chicagoDay(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}

export function materialsLeft(db: DatabaseSync, now: number): number {
  const spent = Number(kvGet(db, `materials-spent:${chicagoDay(now)}`) ?? "0");
  return Math.max(0, DAILY_MATERIALS - (Number.isFinite(spent) ? spent : 0));
}

export function listBuilds(db: DatabaseSync): WorldBuild[] {
  const rows = db.prepare("SELECT * FROM world_builds ORDER BY created_at DESC").all() as BuildRow[];
  return rows.map(toBuild);
}

export function visibleBuilds(db: DatabaseSync): WorldBuild[] {
  return listBuilds(db).filter((build) => build.status === "placed");
}

export function creativeLogEntries(db: DatabaseSync): BuildEntry[] {
  const rows = db.prepare("SELECT sha, title, summary, at_ms FROM creative_log WHERE undone = 0 ORDER BY at_ms DESC").all() as { sha: string; title: string; summary: string; at_ms: number }[];
  return rows.map((row) => ({
    sha: row.sha,
    title: row.title,
    summary: row.summary,
    date: new Date(row.at_ms).toISOString(),
    image: "",
  }));
}

/** Visitors cannot place a build. A flagged note can only inspire Zoora's own proposal. */
export function visitorBuildRequest(): { ok: false; reason: "VISITOR" } {
  return { ok: false, reason: "VISITOR" };
}

export function slotWorld(placeId: AreaId, slot: BuildSlot): { x: number; z: number } {
  const area = areaById(placeId);
  if (!area) return { x: slot.dx, z: slot.dz };
  return { x: area.x + slot.dx, z: area.z + slot.dz };
}

export function positionAllowed(placeId: string, x: number, z: number): { ok: true } | { ok: false; reason: string } {
  const area = areaById(placeId);
  if (!area) return { ok: false, reason: "PLACE" };
  const onSlot = area.buildSlots.some((slot) => {
    const world = slotWorld(area.id, slot);
    return Math.hypot(world.x - x, world.z - z) < 0.2;
  });
  if (!onSlot) return { ok: false, reason: "ZONE" };
  if (Math.hypot(x - area.x, z - area.z) < DOOR_CLEARANCE) return { ok: false, reason: "DOOR" };
  for (const other of AREAS) {
    if (other.id === "town-center") continue;
    if (pointSegmentDistance(x, z, 0, 0, other.x, other.z) < PATH_CLEARANCE) return { ok: false, reason: "PATH" };
  }
  if (area.id === "beach-dock") {
    const len = Math.hypot(area.x, area.z) || 1;
    const outward = ((x - area.x) * area.x + (z - area.z) * area.z) / len;
    if (outward > 0.8) return { ok: false, reason: "DOCK" };
  }
  return { ok: true };
}

export type CreativeDraft = {
  placeId: AreaId;
  emotion: string;
  title: string;
  why: string;
  influenced: boolean;
  params: BuildParams;
  impulse: "new" | "revise" | "tear";
};

export function chooseCreative(signals: CreativeSignals, prior: BuildParams | null = null, hasWork = false): CreativeDraft {
  const emotion = hottest(signals.emotions);
  const influenced = Boolean(signals.ideaSourceKey);
  const memory = influenced ? "" : scrubInstructions(signals.memory ?? "");
  const idea = influenced ? "" : scrubInstructions(signals.ideaTitle ?? "");
  const research = influenced ? "" : scrubInstructions(signals.research ?? "");
  const params = composeParams(emotion, signals.emotions[emotion] ?? 0, memory, idea, research, prior);
  const title = pieceName(memory, idea, research, emotion);
  const placeId = placeFor(emotion, signals.placeId);
  const why = whyLine(title, emotion, memory, research, influenced);
  const impulse = signals.emotions.frustration > 0.75 && hasWork ? "tear" : signals.emotions.calm > 0.55 && hasWork ? "revise" : "new";
  return { placeId, emotion, title, why, influenced, params, impulse };
}

export function placeCreative(db: DatabaseSync, signals: CreativeSignals, now: number): { ok: true; build: WorldBuild } | { ok: false; reason: string } {
  if (!creativeEnabled(db)) return { ok: false, reason: "OFF" };
  if (creativeSpendIntents().length) return { ok: false, reason: "SPEND" };
  const placedWorks = listBuilds(db).filter((build) => build.status === "placed");
  const prior = placedWorks[0] ?? null;
  const draft = chooseCreative(signals, prior?.params ?? null, Boolean(prior));
  if (draft.params.size < 0.4 || draft.params.size > 1.6) return { ok: false, reason: "SIZE" };
  if (draft.impulse === "tear" && prior) return tearDown(db, prior, draft.why, now);
  if (draft.impulse === "revise" && prior) return reviseBuild(db, prior, draft, now);
  const size = draft.params.size;
  const day = chicagoDay(now);
  const today = listBuilds(db).filter((build) => build.status !== "undone" && chicagoDay(build.createdAt) === day);
  if (today.length >= DAILY_BUILD_CAP) return { ok: false, reason: "DAY_CAP" };
  const cost = materialCost(size);
  if (materialsLeft(db, now) < cost) return { ok: false, reason: "MATERIALS" };
  const order = [draft.placeId, ...AREAS.map((area) => area.id).filter((id) => id !== draft.placeId)];
  let chosen: { areaId: AreaId; slot: BuildSlot } | null = null;
  let sawFull = false;
  for (const placeId of order) {
    const area = areaById(placeId);
    if (!area) continue;
    const occupying = listBuilds(db).filter((build) => build.placeId === placeId && build.status !== "undone");
    if (occupying.length >= PLACE_BUILD_CAP) {
      sawFull = true;
      continue;
    }
    const slot = area.buildSlots.find((candidate) => {
      const world = slotWorld(area.id, candidate);
      if (!positionAllowed(area.id, world.x, world.z).ok) return false;
      return occupying.every((build) => Math.hypot(build.x - world.x, build.z - world.z) >= 1.5);
    });
    if (slot) {
      chosen = { areaId: area.id, slot };
      break;
    }
  }
  if (!chosen) return { ok: false, reason: sawFull ? "PLACE_CAP" : "ZONE" };
  const world = slotWorld(chosen.areaId, chosen.slot);
  const id = `build-${randomBytes(6).toString("hex")}`;
  const build: WorldBuild = {
    id,
    version: 1,
    placeId: chosen.areaId,
    kind: "decoration",
    title: draft.title,
    why: draft.why,
    emotion: draft.emotion,
    x: world.x,
    z: world.z,
    size,
    yaw: Math.atan2(chosen.slot.dx, chosen.slot.dz),
    status: "placed",
    materials: cost,
    influenced: draft.influenced,
    createdAt: now,
    params: draft.params,
  };
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("INSERT INTO diary(text, tone, private, created_at) VALUES(?, 'steady', 0, ?)").run(build.why, now);
    insertBuild(db, build);
    recordVersion(db, build, now);
    const spent = DAILY_MATERIALS - materialsLeft(db, now);
    kvSet(db, `materials-spent:${day}`, String(spent + cost));
    db.prepare("INSERT INTO creative_log(build_id, sha, title, summary, at_ms, undone) VALUES(?, ?, ?, ?, ?, 0)").run(
      build.id,
      build.id.slice(0, 12),
      build.title,
      build.why,
      now,
    );
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* already closed */ }
    throw error;
  }
  return { ok: true, build };
}

export function hideBuild(db: DatabaseSync, id: string, now: number): { ok: true; build: WorldBuild } | { ok: false; reason: string } {
  return changeStatus(db, id, "placed", "hidden", now);
}

export function undoBuild(db: DatabaseSync, id: string, now: number): { ok: true; build: WorldBuild } | { ok: false; reason: string } {
  const current = listBuilds(db).find((build) => build.id === id);
  if (!current || current.status === "undone") return { ok: false, reason: "NOT_PLACED" };
  const changed = changeStatus(db, id, current.status, "undone", now);
  if (!changed.ok) return changed;
  rememberChunkDecor(db, changed.build, "decor-rollback", now);
  db.prepare("UPDATE creative_log SET undone = 1 WHERE build_id = ?").run(id);
  if (chicagoDay(current.createdAt) === chicagoDay(now)) {
    const key = `materials-spent:${chicagoDay(now)}`;
    const spent = Number(kvGet(db, key) ?? "0");
    kvSet(db, key, String(Math.max(0, spent - current.materials)));
  }
  return changed;
}

export function buildVersions(db: DatabaseSync, id: string): { version: number; status: string; atMs: number }[] {
  const rows = db.prepare("SELECT version, status, at_ms FROM world_build_versions WHERE build_id = ? ORDER BY version ASC").all(id) as { version: number; status: string; at_ms: number }[];
  return rows.map((row) => ({ version: row.version, status: row.status, atMs: row.at_ms }));
}

function changeStatus(db: DatabaseSync, id: string, from: string, to: BuildStatus, now: number): { ok: true; build: WorldBuild } | { ok: false; reason: string } {
  const current = listBuilds(db).find((build) => build.id === id);
  if (!current || (from !== current.status && to !== "undone")) return { ok: false, reason: "NOT_PLACED" };
  if (current.status === "undone") return { ok: false, reason: "NOT_PLACED" };
  if (to === "hidden" && current.status !== "placed") return { ok: false, reason: "NOT_PLACED" };
  const next = { ...current, status: to, version: current.version + 1 };
  db.prepare("UPDATE world_builds SET status = ?, version = ? WHERE id = ?").run(to, next.version, id);
  recordVersion(db, next, now);
  return { ok: true, build: next };
}

function insertBuild(db: DatabaseSync, build: WorldBuild): void {
  db.prepare(
    `INSERT INTO world_builds(id, version, place_id, kind, title, why, emotion, x, z, size, yaw, status, materials, influenced, created_at, params)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(build.id, build.version, build.placeId, build.kind, build.title, build.why, build.emotion, build.x, build.z, build.size, build.yaw, build.status, build.materials, build.influenced ? 1 : 0, build.createdAt, JSON.stringify(build.params));
  recordProvenance(db, {
    pieceKind: "build",
    pieceId: build.id,
    atMs: build.createdAt,
    flaggedVisitorText: build.influenced ? build.why : null,
  });
  rememberChunkDecor(db, build, "decor", build.createdAt);
}

function recordVersion(db: DatabaseSync, build: WorldBuild, now: number): void {
  db.prepare("INSERT INTO world_build_versions(build_id, version, status, at_ms) VALUES(?, ?, ?, ?)").run(build.id, build.version, build.status, now);
}

function toBuild(row: BuildRow): WorldBuild {
  return {
    id: row.id,
    version: row.version,
    placeId: row.place_id as AreaId,
    kind: row.kind as BuildKind,
    title: row.title,
    why: row.why,
    emotion: row.emotion,
    x: row.x,
    z: row.z,
    size: row.size,
    yaw: row.yaw,
    status: row.status as BuildStatus,
    materials: row.materials,
    influenced: row.influenced === 1,
    createdAt: row.created_at,
    params: readParams(row.params, row.size),
  };
}

export function creativeBoard(db: DatabaseSync, now: number): { on: boolean; left: number; builds: WorldBuild[] } {
  return { on: creativeEnabled(db), left: materialsLeft(db, now), builds: listBuilds(db).slice(0, 16) };
}

export function considerCreative(db: DatabaseSync, state: { emotions: Emotions; placeId: string; longTerm: { text: string }[] }, now: number): WorldBuild | null {
  if (!creativeEnabled(db)) return null;
  const last = Number(kvGet(db, "creative_last_at") ?? "0");
  if (Number.isFinite(last) && last > 0 && now - last < 30 * 60_000) return null;
  const idea = db.prepare("SELECT title, source_key FROM ideas ORDER BY updated_at DESC LIMIT 1").get() as { title: string; source_key: string | null } | undefined;
  const research = db.prepare("SELECT question FROM findings ORDER BY at_ms DESC LIMIT 1").get() as { question: string } | undefined;
  const placed = placeCreative(db, {
    emotions: state.emotions,
    placeId: state.placeId || "town-center",
    ideaTitle: idea?.title ?? null,
    ideaSourceKey: idea?.source_key ?? null,
    memory: state.longTerm[0]?.text ?? null,
    research: research?.question ?? null,
  }, now);
  if (!placed.ok) return null;
  kvSet(db, "creative_last_at", String(now));
  return placed.build;
}

function hottest(emotions: Emotions): EmotionName {
  let best: EmotionName = "calm";
  let score = -1;
  for (const [name, value] of Object.entries(emotions) as [EmotionName, number][]) {
    if (value > score) {
      best = name;
      score = value;
    }
  }
  return best;
}

function materialCost(size: number): number {
  return Math.max(1, Math.min(4, Math.round(size * 2)));
}

function tearDown(db: DatabaseSync, current: WorldBuild, why: string, now: number): { ok: true; build: WorldBuild } | { ok: false; reason: string } {
  const undone = undoBuild(db, current.id, now);
  if (!undone.ok) return undone;
  db.prepare("INSERT INTO diary(text, tone, private, created_at) VALUES(?, 'sparse', 0, ?)").run(why, now);
  return undone;
}

function reviseBuild(db: DatabaseSync, current: WorldBuild, draft: CreativeDraft, now: number): { ok: true; build: WorldBuild } | { ok: false; reason: string } {
  if (materialsLeft(db, now) < 1) return { ok: false, reason: "MATERIALS" };
  const size = Math.min(1.6, Math.max(0.4, draft.params.size));
  const next: WorldBuild = {
    ...current,
    version: current.version + 1,
    title: draft.title,
    why: draft.why,
    emotion: draft.emotion,
    size,
    params: { ...draft.params, size },
    materials: current.materials,
  };
  db.prepare("UPDATE world_builds SET version = ?, title = ?, why = ?, emotion = ?, size = ?, params = ? WHERE id = ?").run(
    next.version, next.title, next.why, next.emotion, next.size, JSON.stringify(next.params), current.id,
  );
  recordVersion(db, next, now);
  const day = chicagoDay(now);
  kvSet(db, `materials-spent:${day}`, String(DAILY_MATERIALS - materialsLeft(db, now) + 1));
  db.prepare("UPDATE creative_log SET title = ?, summary = ? WHERE build_id = ?").run(next.title, next.why, current.id);
  db.prepare("INSERT INTO diary(text, tone, private, created_at) VALUES(?, 'steady', 0, ?)").run(next.why, now);
  rememberChunkDecor(db, next, "decor", now);
  return { ok: true, build: next };
}

/** Zoora's decor on her home chunk. Visitors have no caller. No scripts and no new route. */
function rememberChunkDecor(db: DatabaseSync, build: WorldBuild, action: "decor" | "decor-rollback", now: number): void {
  const spot = worldToChunk(build.x, build.z);
  if (spot.cx !== HOME_CHUNK.cx || spot.cy !== HOME_CHUNK.cy) return;
  appendChunkEdit(db, {
    id: `edit-${build.id}-v${build.version}-${action}`,
    atMs: now,
    chunkX: HOME_CHUNK.cx,
    chunkY: HOME_CHUNK.cy,
    tileX: spot.tx,
    tileY: spot.ty,
    kind: action,
    payload: decorPayload(build),
    actor: "zoora",
    idempotencyKey: `decor:${build.id}:v${build.version}:${action}`,
  });
}

function composeParams(emotion: string, level: number, memory: string, idea: string, research: string, prior: BuildParams | null): BuildParams {
  const seed = hashText(`${emotion}|${memory}|${idea}|${research}`);
  const hue = prior ? (prior.hue + 17 + (seed % 23)) % 360 : (seed + emotion.length * 13) % 360;
  const parts = 2 + (seed % 4);
  const twist = ((seed >>> 4) % 100) / 100;
  const form = (seed >>> 8) % 6;
  const size = Math.min(1.6, Math.max(0.4, 0.45 + Math.min(1, level) * 0.9));
  return { hue, parts, twist, form, size: Math.round(size * 100) / 100 };
}

function pieceName(memory: string, idea: string, research: string, emotion: string): string {
  const pool = [...tokens(memory), ...tokens(idea), ...tokens(research)];
  const a = pool[0] ?? emotion;
  const b = pool.find((word) => word !== a) ?? "glow";
  return `${a.slice(0, 1).toUpperCase()}${a.slice(1)} ${b}`.slice(0, 60);
}

function whyLine(title: string, emotion: string, memory: string, research: string, influenced: boolean): string {
  if (influenced) return `I made ${title} while I feel ${emotion}. I left the visitor's words off the shape.`;
  const remembered = memory ? ` I was remembering ${memory}.` : "";
  const wonder = research ? ` I wonder about ${research}.` : "";
  return `I made ${title} because I feel ${emotion}.${remembered}${wonder}`.replace(/\s+/g, " ").trim().slice(0, 280);
}

function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((word) => !NAME_SKIP.has(word)).slice(0, 6);
}

const NAME_SKIP = new Set(["that", "this", "with", "from", "have", "about", "there", "would", "could", "while", "still", "water", "because"]);

function hashText(text: string): number {
  let value = 2166136261;
  for (const char of text) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  return value >>> 0;
}

function readParams(raw: string | undefined, size: number): BuildParams {
  try {
    const parsed = JSON.parse(raw || "{}") as Partial<BuildParams>;
    return {
      hue: Number(parsed.hue) || 0,
      parts: Number(parsed.parts) || 3,
      twist: Number(parsed.twist) || 0,
      form: Number(parsed.form) || 0,
      size: Number(parsed.size) || size,
    };
  } catch {
    return { hue: 0, parts: 3, twist: 0, form: 0, size };
  }
}

function placeFor(emotion: EmotionName, current: string): AreaId {
  const preferred: Partial<Record<EmotionName, AreaId>> = {
    joy: "art-studio",
    pride: "art-studio",
    calm: "garden-greenhouse",
    curiosity: "research-station",
    loneliness: "music-studio",
    frustration: "forest-trail",
    worry: "lighthouse-hill",
    boredom: "town-center",
  };
  const wanted = preferred[emotion] ?? "town-center";
  if (areaById(current)?.buildSlots.length) return (preferred[emotion] && emotion !== "boredom" ? wanted : current) as AreaId;
  return wanted;
}


function pointSegmentDistance(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const abx = bx - ax;
  const abz = bz - az;
  const ab2 = abx * abx + abz * abz;
  const t = ab2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * abx + (pz - az) * abz) / ab2));
  return Math.hypot(px - (ax + abx * t), pz - (az + abz * t));
}
