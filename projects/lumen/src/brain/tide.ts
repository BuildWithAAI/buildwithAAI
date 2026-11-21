import type { EmotionName, Emotions } from "./types";

/**
 * Tidal memory. Zoora's own way of keeping and losing things.
 *
 * A memory is laid on the surface with the feeling, place, tide and season it happened under.
 * Once a world day, whatever was not revisited sinks one layer: surface, shallows, deep.
 * A memory loses its words before it is lost. In the deep it is a fragment. Below the deep it is
 * sediment: only a count of how a place felt. A feeling lights the memories laid under the same
 * feeling or place, and a lit memory rises. A memory lit on enough different days hardens into a
 * pearl. There is room for a few pearls only, so a new one means an old one dissolves.
 * A storm churns the deep, lifts old fragments, washes sediment away, and leaves a dream.
 *
 * Everything here is plain arithmetic on the state. No model is asked and nothing is fetched.
 * Text from visitors or the web is foreign water: it can be kept, but it is never lit and never a pearl.
 */

export const SURFACE_CAP = 24;
export const SHALLOWS_CAP = 64;
export const DEEP_CAP = 128;
export const PEARL_CAP = 12;
export const PEARL_DAYS = 9;
export const LIT_PER_DAY = 12;
export const DREAM_CAP = 8;
const LAY_FLOOR = 0.5;
const CATCH_UP_DAYS = 7;

export type TideLevel = "low" | "mid" | "high";
export type Layer = 0 | 1 | 2;
export const LAYER_NAMES = ["surface", "shallows", "deep"] as const;

export type TideMemory = {
  id: string;
  layer: Layer;
  text: string;
  feeling: EmotionName;
  importance: number;
  placeId: string | null;
  season: string;
  tide: TideLevel;
  laidDay: number;
  litDays: number[];
  foreign: boolean;
};

export type Pearl = { id: string; text: string; feeling: EmotionName; placeId: string | null; formedDay: number; lastLitDay: number; lit: number };

export type TideState = {
  memories: TideMemory[];
  pearls: Pearl[];
  /** How a place has felt, after the words are gone. Key is `place|feeling`. */
  sediment: Record<string, number>;
  /** Places the lit memories pull toward (above zero) or away from (below zero). */
  pull: Record<string, number>;
  lastSinkDay: number;
  dreams: string[];
  dissolved: number;
};

export type Cue = { feeling: EmotionName; placeId: string | null; season: string; tide: TideLevel };

const WARM: readonly EmotionName[] = ["joy", "calm", "curiosity", "pride"];

export function emptyTide(day: number): TideState {
  return { memories: [], pearls: [], sediment: {}, pull: {}, lastSinkDay: day, dreams: [], dissolved: 0 };
}

export function tideLevel(tide: number): TideLevel {
  if (tide < 0.34) return "low";
  if (tide > 0.66) return "high";
  return "mid";
}

function round(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 10000) / 10000;
}

function plain(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** The first clause, six words at most. What is left of a line once it reaches the deep. */
export function fragment(text: string): string {
  const clause = text.split(/[.!?;,—]/)[0] ?? text;
  const words = clause.trim().split(/\s+/).filter(Boolean).slice(0, 6);
  if (!words.length) return "";
  return `${words.join(" ")}…`;
}

/**
 * How much a moment matters. It comes from how strongly she felt and how new the line is,
 * not from what kind of event it was. A storm she barely felt is not kept above a ring she was proud of.
 */
export function importanceOf(tide: TideState, emotions: Emotions, feeling: EmotionName, text: string, marked: boolean): number {
  const key = plain(text);
  const seen = tide.memories.some((memory) => memory.layer < 2 && plain(memory.text) === key);
  const novelty = seen ? 0.15 : 1;
  return round(0.5 * emotions[feeling] + 0.35 * novelty + (marked ? 0.15 : 0));
}

export function lay(tide: TideState, entry: Omit<TideMemory, "layer" | "litDays">): TideState {
  if (!entry.text.trim() || entry.importance < LAY_FLOOR) return tide;
  const key = plain(entry.text);
  const same = tide.memories.find((memory) => memory.layer === 0 && plain(memory.text) === key);
  if (same) {
    const memories = tide.memories.map((memory) => (memory === same ? { ...memory, importance: round(Math.max(memory.importance, entry.importance)) } : memory));
    return { ...tide, memories };
  }
  return settle({ ...tide, memories: [...tide.memories, { ...entry, layer: 0, litDays: [] }] });
}

/** Keep each layer inside its cap. What does not fit sinks. What sinks out of the deep becomes sediment. */
function settle(tide: TideState): TideState {
  let memories = tide.memories;
  const sediment = { ...tide.sediment };
  const caps = [SURFACE_CAP, SHALLOWS_CAP, DEEP_CAP] as const;
  for (const layer of [0, 1, 2] as const) {
    const here = memories.filter((memory) => memory.layer === layer);
    if (here.length <= caps[layer]) continue;
    // What she has never returned to goes first. Then what mattered least. Then what is oldest.
    const order = [...here].sort((a, b) => a.litDays.length - b.litDays.length || a.importance - b.importance || a.laidDay - b.laidDay);
    const down = new Set(order.slice(0, here.length - caps[layer]).map((memory) => memory.id));
    memories = memories.flatMap((memory) => {
      if (!down.has(memory.id)) return [memory];
      const sunk = sinkOne(memory, sediment);
      return sunk ? [sunk] : [];
    });
  }
  return { ...tide, memories, sediment };
}

function sinkOne(memory: TideMemory, sediment: Record<string, number>): TideMemory | null {
  if (memory.layer === 2) {
    const key = `${memory.placeId ?? "open-water"}|${memory.feeling}`;
    sediment[key] = (sediment[key] ?? 0) + 1;
    return null;
  }
  const layer = (memory.layer + 1) as Layer;
  return { ...memory, layer, text: layer === 2 ? fragment(memory.text) || memory.text : memory.text };
}

/** One sink per world day that has passed. A memory lit on the day it would have sunk stays where it is. */
export function sinkDays(tide: TideState, day: number): TideState {
  if (day <= tide.lastSinkDay) return tide;
  let next = tide;
  const from = Math.max(tide.lastSinkDay, day - CATCH_UP_DAYS);
  for (let passed = from; passed < day; passed += 1) {
    const sediment = { ...next.sediment };
    const memories = next.memories.flatMap((memory) => {
      if (memory.litDays.includes(passed)) return [memory];
      const sunk = sinkOne(memory, sediment);
      return sunk ? [sunk] : [];
    });
    next = settle({ ...next, memories, sediment });
  }
  return { ...next, lastSinkDay: day };
}

function match(cue: Cue, item: { feeling: EmotionName; placeId: string | null; season?: string; tide?: TideLevel }): number {
  let score = 0;
  if (item.feeling === cue.feeling) score += 1;
  if (item.placeId && item.placeId === cue.placeId) score += 0.6;
  if (item.season && item.season === cue.season) score += 0.2;
  if (item.tide && item.tide === cue.tide) score += 0.2;
  return score;
}

export type Glow = {
  tide: TideState;
  /** Memories that rose from below the surface on this call. */
  risen: TideMemory[];
  formed: Pearl | null;
  dissolved: Pearl | null;
};

/**
 * Her present feeling lights what was laid under the same feeling or in the same place.
 * A lit memory rises one layer and is marked for the day. It keeps whatever words it has left:
 * a fragment that rises is still a fragment. Each memory counts once a day, and a day lights a few only.
 */
export function glow(tide: TideState, cue: Cue, day: number, limit = 2): Glow {
  const litToday = tide.memories.filter((memory) => memory.litDays.includes(day)).length;
  const room = Math.max(0, Math.min(limit, LIT_PER_DAY - litToday));
  const pearls = tide.pearls.map((pearl) => (match(cue, pearl) >= 1 && pearl.lastLitDay !== day ? { ...pearl, lastLitDay: day, lit: pearl.lit + 1 } : pearl));
  if (room === 0) return { tide: { ...tide, pearls }, risen: [], formed: null, dissolved: null };
  const chosen = tide.memories
    .filter((memory) => !memory.foreign && !memory.litDays.includes(day))
    .map((memory) => ({ memory, score: match(cue, memory) + memory.importance * 0.5 - memory.layer * 0.15 }))
    .filter((item) => match(cue, item.memory) >= 1)
    .sort((a, b) => b.score - a.score || a.memory.laidDay - b.memory.laidDay)
    .slice(0, room)
    .map((item) => item.memory.id);
  if (!chosen.length) return { tide: { ...tide, pearls, pull: pullOf(tide, cue) }, risen: [], formed: null, dissolved: null };
  const picked = new Set(chosen);
  const risen: TideMemory[] = [];
  let memories = tide.memories.map((memory) => {
    if (!picked.has(memory.id)) return memory;
    const lit = { ...memory, layer: Math.max(0, memory.layer - 1) as Layer, litDays: [...memory.litDays, day].slice(-16) };
    if (memory.layer > 0) risen.push(lit);
    return lit;
  });
  let formed: Pearl | null = null;
  let dissolved: Pearl | null = null;
  let kept = pearls;
  let lost = tide.dissolved;
  const ripe = memories.find((memory) => picked.has(memory.id) && new Set(memory.litDays).size >= PEARL_DAYS);
  if (ripe) {
    formed = { id: `pearl-${ripe.id}`, text: ripe.text, feeling: ripe.feeling, placeId: ripe.placeId, formedDay: day, lastLitDay: day, lit: ripe.litDays.length };
    memories = memories.filter((memory) => memory.id !== ripe.id);
    if (kept.length >= PEARL_CAP) {
      // The one she has gone longest without returning to. Among those, the one she returned to least.
      dissolved = [...kept].sort((a, b) => a.lastLitDay - b.lastLitDay || a.lit - b.lit || a.formedDay - b.formedDay)[0] ?? null;
      kept = kept.filter((pearl) => pearl.id !== dissolved?.id);
      lost += 1;
    }
    kept = [...kept, formed];
  }
  const next = settle({ ...tide, memories, pearls: kept, dissolved: lost });
  return { tide: { ...next, pull: pullOf(next, cue) }, risen, formed, dissolved };
}

/**
 * Where today's lit memories and the sediment lean. A place that held warm feelings pulls.
 * A place that held hard ones pushes. Bounded, so memory tilts a choice and does not make it.
 */
export function pullOf(tide: TideState, cue: Cue): Record<string, number> {
  const pull: Record<string, number> = {};
  const add = (placeId: string | null, feeling: EmotionName, weight: number) => {
    if (!placeId || placeId === "open-water") return;
    pull[placeId] = (pull[placeId] ?? 0) + (WARM.includes(feeling) ? weight : -weight);
  };
  for (const memory of tide.memories) {
    if (memory.foreign || memory.layer > 1) continue;
    if (memory.feeling === cue.feeling || memory.litDays.length > 0) add(memory.placeId, memory.feeling, memory.importance * 0.12);
  }
  for (const pearl of tide.pearls) add(pearl.placeId, pearl.feeling, 0.2);
  for (const [key, count] of Object.entries(tide.sediment)) {
    const [placeId, feeling] = key.split("|") as [string, EmotionName];
    add(placeId, feeling, Math.min(0.2, count * 0.01));
  }
  for (const place of Object.keys(pull)) pull[place] = Math.round(Math.min(0.6, Math.max(-0.4, pull[place] ?? 0)) * 1000) / 1000;
  return pull;
}

/**
 * A storm churns the deep. Two old fragments are lifted into the shallows, about a third of the
 * sediment is washed away for good, and the two fragments are left side by side as a dream.
 */
export function churn(tide: TideState, rng: () => number): { tide: TideState; dream: string | null } {
  const deep = tide.memories.filter((memory) => memory.layer === 2 && !memory.foreign);
  const lifted: TideMemory[] = [];
  const pool = [...deep];
  while (lifted.length < 2 && pool.length) lifted.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]!);
  const up = new Set(lifted.map((memory) => memory.id));
  const memories = tide.memories.map((memory) => (up.has(memory.id) ? { ...memory, layer: 1 as Layer } : memory));
  const sediment: Record<string, number> = {};
  for (const [key, count] of Object.entries(tide.sediment)) {
    const left = Math.floor(count * 0.7);
    if (left > 0) sediment[key] = left;
  }
  const dream = lifted.length === 2 ? `${lifted[0]!.text} ${lifted[1]!.text}` : null;
  const dreams = dream ? [...tide.dreams, dream].slice(-DREAM_CAP) : tide.dreams;
  return { tide: settle({ ...tide, memories, sediment, dreams }), dream };
}

/** Counts that only ever grew made every act and every event matter less each day. Half is forgotten each day. */
export function fadeCounts(counts: Record<string, number>): Record<string, number> {
  const next: Record<string, number> = {};
  for (const [key, count] of Object.entries(counts)) {
    const left = Math.floor(count / 2);
    if (left > 0) next[key] = left;
  }
  return next;
}

export function tideSummary(tide: TideState): { surface: number; shallows: number; deep: number; sediment: number; pearls: number; dreams: number; dissolved: number } {
  const count = (layer: Layer) => tide.memories.filter((memory) => memory.layer === layer).length;
  return {
    surface: count(0),
    shallows: count(1),
    deep: count(2),
    sediment: Object.values(tide.sediment).reduce((sum, value) => sum + value, 0),
    pearls: tide.pearls.length,
    dreams: tide.dreams.length,
    dissolved: tide.dissolved,
  };
}
