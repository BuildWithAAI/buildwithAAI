import type { DatabaseSync } from "node:sqlite";
import type { EmotionName, Emotions } from "../brain/types";
import { kvGet, kvSet } from "../db/db";
import { scrubInstructions } from "../research/ideas";

export const PALETTES = ["tide", "lantern", "dusk", "moss"] as const;
export const SKY_MOODS = ["day", "gold", "overcast", "night-wash"] as const;
export const SCENE_WEATHER = ["clear", "mist", "soft-rain", "still"] as const;
export const DECORATIONS = ["none", "shells", "lanterns", "kelp"] as const;
export const SCENE_GAP_MS = 10 * 60_000;
export const SCENE_DAY_CAP = 8;

export type Palette = (typeof PALETTES)[number];
export type SkyMood = (typeof SKY_MOODS)[number];
export type SceneWeather = (typeof SCENE_WEATHER)[number];
export type Decoration = (typeof DECORATIONS)[number];

export type SceneState = {
  palette: Palette;
  sky: SkyMood;
  weather: SceneWeather;
  decoration: Decoration;
  gardenStage: 0 | 1 | 2 | 3;
  galleryIds: string[];
  why: string;
  atMs: number;
};

const FIELDS = new Set(["palette", "sky", "weather", "decoration", "gardenStage", "galleryIds", "why", "atMs"]);

const WHY: Record<EmotionName, string> = {
  joy: "I picked the lantern light because the water feels bright.",
  calm: "I kept the tide colors because the bowl is quiet.",
  curiosity: "I opened the sky a little because I want to look farther.",
  loneliness: "I left a few shells out so the shore is not empty.",
  frustration: "I dimmed the palette because the water is loud.",
  pride: "I set the pieces I still like where they can be seen.",
  boredom: "I changed one decoration because the view had gone flat.",
  worry: "I kept the garden low and the weather still.",
};

export function sceneWhy(emotion: EmotionName, visitorNote: string | null): string {
  const canned = WHY[emotion] ?? WHY.calm;
  if (!visitorNote) return canned;
  const clean = scrubInstructions(visitorNote);
  if (!clean) return canned;
  return canned;
}

export function parseScene(input: unknown, knownIds: ReadonlySet<string> = new Set()): SceneState | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;
  if (Object.keys(record).some((key) => !FIELDS.has(key))) return null;
  if (!PALETTES.includes(record.palette as Palette)) return null;
  if (!SKY_MOODS.includes(record.sky as SkyMood)) return null;
  if (!SCENE_WEATHER.includes(record.weather as SceneWeather)) return null;
  if (!DECORATIONS.includes(record.decoration as Decoration)) return null;
  if (record.gardenStage !== 0 && record.gardenStage !== 1 && record.gardenStage !== 2 && record.gardenStage !== 3) return null;
  if (typeof record.why !== "string" || record.why.length < 8 || record.why.length > 180) return null;
  if (/https?:\/\//i.test(record.why) || /\b(spend|price|checkout)\b/i.test(record.why)) return null;
  if (!Array.isArray(record.galleryIds) || record.galleryIds.length > 6) return null;
  if (!record.galleryIds.every((id) => typeof id === "string" && id.length > 0 && id.length < 80 && (knownIds.size === 0 || knownIds.has(id)))) return null;
  if (typeof record.atMs !== "number" || !Number.isFinite(record.atMs)) return null;
  return {
    palette: record.palette as Palette,
    sky: record.sky as SkyMood,
    weather: record.weather as SceneWeather,
    decoration: record.decoration as Decoration,
    gardenStage: record.gardenStage,
    galleryIds: record.galleryIds as string[],
    why: record.why,
    atMs: record.atMs,
  };
}

export function chooseScene(emotion: EmotionName, tick: number, galleryIds: string[], atMs: number): SceneState {
  const step = Math.abs(Math.floor(tick));
  const paletteFor: Record<EmotionName, Palette> = {
    joy: "lantern",
    calm: "tide",
    curiosity: "dusk",
    loneliness: "tide",
    frustration: "dusk",
    pride: "lantern",
    boredom: "moss",
    worry: "moss",
  };
  const scene: SceneState = {
    palette: paletteFor[emotion] ?? "tide",
    sky: SKY_MOODS[step % SKY_MOODS.length] ?? "day",
    weather: SCENE_WEATHER[step % SCENE_WEATHER.length] ?? "clear",
    decoration: DECORATIONS[step % DECORATIONS.length] ?? "none",
    gardenStage: (step % 4) as 0 | 1 | 2 | 3,
    galleryIds: galleryIds.filter((id) => id.length > 0).slice(0, 6),
    why: sceneWhy(emotion, null),
    atMs,
  };
  return scene;
}

export function readScene(db: DatabaseSync): SceneState | null {
  const raw = kvGet(db, "world_scene");
  if (!raw) return null;
  try {
    return parseScene(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function sceneChoices(db: DatabaseSync): string[] {
  const raw = kvGet(db, "world_scene_log");
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((line) => typeof line === "string").slice(0, 8);
  } catch {
    return [];
  }
}

export function sceneFrozen(db: DatabaseSync): boolean {
  return kvGet(db, "world_scene_frozen") === "1";
}

export function setSceneFrozen(db: DatabaseSync, on: boolean): void {
  kvSet(db, "world_scene_frozen", on ? "1" : "0");
}

function history(db: DatabaseSync): SceneState[] {
  const raw = kvGet(db, "world_scene_history");
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown[];
    return parsed.map((item) => parseScene(item)).filter((item): item is SceneState => item != null);
  } catch {
    return [];
  }
}

function dayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function publishScene(db: DatabaseSync, scene: SceneState, now: number): { ok: true } | { ok: false; reason: "FROZEN" | "RATE" | "INVALID" } {
  if (!parseScene(scene)) return { ok: false, reason: "INVALID" };
  if (sceneFrozen(db)) return { ok: false, reason: "FROZEN" };
  const last = Number(kvGet(db, "world_scene_last") ?? "0");
  if (Number.isFinite(last) && last > 0 && now - last < SCENE_GAP_MS) return { ok: false, reason: "RATE" };
  const countKey = `world_scene_count:${dayKey(now)}`;
  const count = Number(kvGet(db, countKey) ?? "0");
  if (Number.isFinite(count) && count >= SCENE_DAY_CAP) return { ok: false, reason: "RATE" };
  const prior = history(db);
  kvSet(db, "world_scene_history", JSON.stringify([scene, ...prior].slice(0, 8)));
  kvSet(db, "world_scene", JSON.stringify(scene));
  kvSet(db, "world_scene_last", String(now));
  kvSet(db, countKey, String((Number.isFinite(count) ? count : 0) + 1));
  const line = `${scene.palette} palette, ${scene.sky} sky, ${scene.weather}, ${scene.decoration}. ${scene.why}`;
  const log = [line, ...sceneChoices(db)].slice(0, 8);
  kvSet(db, "world_scene_log", JSON.stringify(log));
  return { ok: true };
}

export function rollbackScene(db: DatabaseSync): { ok: true; scene: SceneState } | { ok: false; reason: "NONE" } {
  const prior = history(db);
  const previous = prior[1];
  if (!previous) return { ok: false, reason: "NONE" };
  const rest = prior.slice(1);
  kvSet(db, "world_scene", JSON.stringify(previous));
  kvSet(db, "world_scene_history", JSON.stringify(rest));
  const log = [`Rolled back to the ${previous.palette} palette.`, ...sceneChoices(db)].slice(0, 8);
  kvSet(db, "world_scene_log", JSON.stringify(log));
  return { ok: true, scene: previous };
}

export function dominantEmotion(emotions: Emotions): EmotionName {
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

export function publishFromTick(db: DatabaseSync, emotions: Emotions, tick: number, now: number): { ok: true } | { ok: false; reason: string } {
  const rows = db.prepare("SELECT id FROM creations ORDER BY created_at DESC LIMIT 6").all() as { id: string }[];
  const scene = chooseScene(dominantEmotion(emotions), tick, rows.map((row) => row.id), now);
  const saved = publishScene(db, scene, now);
  if (!saved.ok) return saved;
  db.prepare("INSERT INTO diary(text, tone, private, created_at) VALUES(?, 'steady', 0, ?)").run(scene.why, now);
  return { ok: true };
}

export function sceneWeatherKind(weather: SceneWeather): "clear" | "rain" {
  return weather === "soft-rain" ? "rain" : "clear";
}

export function sceneWeatherText(weather: SceneWeather): string | null {
  if (weather === "mist") return "Mist on the paths.";
  if (weather === "still") return "The air is still.";
  if (weather === "soft-rain") return "A soft rain.";
  return null;
}
