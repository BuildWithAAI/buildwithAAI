import { clamp01, EMOTION_NAMES, type EmotionName, type Emotions, type Needs } from "./types";

export function decayEmotions(emotions: Emotions, factor = 0.94): Emotions {
  const next = { ...emotions };
  for (const name of EMOTION_NAMES) next[name] = clamp01(next[name] * factor);
  return next;
}

/** Same trigger, weaker each time it actually happens. Speech does not count. */
export function diminishing(base: number, priorCount: number): number {
  const prior = Math.max(0, priorCount);
  return Math.round((base / (1 + prior)) * 10000) / 10000;
}

export function dominantEmotion(emotions: Emotions): EmotionName {
  let best: EmotionName = "calm";
  let score = -1;
  for (const name of EMOTION_NAMES) {
    if (emotions[name] > score) {
      score = emotions[name];
      best = name;
    }
  }
  return best;
}

export function signalsFromNeeds(needs: Needs, stress: number, stormMemory: number, pressure: number): Partial<Emotions> {
  return {
    loneliness: clamp01((needs.social - 0.35) * 0.55),
    curiosity: clamp01((needs.curiosity - 0.3) * 0.5),
    frustration: clamp01((needs.expression - 0.75) * 0.35 + (needs.quiet - 0.8) * 0.2),
    worry: clamp01(stress * 0.45 + (stormMemory > 0.2 && pressure > 0.6 ? stormMemory * 0.4 : 0)),
    calm: clamp01((1 - (needs.rest + needs.quiet) / 2) * 0.4 * (1 - stress)),
    joy: clamp01((0.45 - needs.social) * 0.2 + (0.4 - needs.expression) * 0.15),
  };
}

export function blendEmotions(decayed: Emotions, signals: Partial<Emotions>, impulse: Partial<Emotions> = {}): Emotions {
  const next = { ...decayed };
  for (const name of EMOTION_NAMES) {
    const signal = signals[name] ?? 0;
    const bump = impulse[name] ?? 0;
    next[name] = clamp01(next[name] + signal * 0.35 + bump);
  }
  return next;
}

/** Repeated acts or a tiny emotional loop push toward something else. */
export function loopDamp(emotions: Emotions, recentActions: string[], recentDominant: EmotionName[]): Emotions {
  const next = { ...emotions };
  const acts = recentActions.slice(-4);
  if (acts.length === 4 && new Set(acts).size === 1) next.boredom = clamp01(next.boredom + 0.2);
  const moods = recentDominant.slice(-6);
  if (moods.length === 6 && new Set(moods).size <= 2) next.boredom = clamp01(next.boredom + 0.15);
  return next;
}

export function feelingSentence(emotions: Emotions, mood: number, energy: number, stress: number): string {
  const dom = dominantEmotion(emotions);
  const moodWord = mood < -0.3 ? "low" : mood > 0.45 ? "bright" : "even";
  const energyWord = energy < 0.2 ? "thin" : energy > 0.8 ? "restless" : "steady";
  const stressWord = stress > 0.62 ? " The pile of notes is loud." : "";
  return `I feel ${dom}. The water is ${moodWord} and my pulse is ${energyWord}.${stressWord}`;
}

export type Glow = { color: string; pulseMs: number; amplitude: number };

export function glowFor(emotions: Emotions, mood: number): Glow {
  const dom = dominantEmotion(emotions);
  const table: Record<EmotionName, Glow> = {
    joy: { color: "#ffd27a", pulseMs: 1600, amplitude: 0.85 },
    calm: { color: "#8ef0d8", pulseMs: 3200, amplitude: 0.35 },
    curiosity: { color: "#7ee7ff", pulseMs: 1400, amplitude: 0.6 },
    loneliness: { color: "#6f8cff", pulseMs: 2800, amplitude: 0.28 },
    frustration: { color: "#ff6b8a", pulseMs: 700, amplitude: 0.95 },
    pride: { color: "#fff1c9", pulseMs: 2000, amplitude: 0.7 },
    boredom: { color: "#8aa399", pulseMs: 2400, amplitude: 0.22 },
    worry: { color: "#c7b0ff", pulseMs: 900, amplitude: 0.55 },
  };
  const glow = table[dom];
  if (mood < -0.4) return { ...glow, amplitude: Math.max(0.15, glow.amplitude * 0.6) };
  return glow;
}

/** Plain-language only. No numeric levers for the model to grab. */
export function emotionWords(emotions: Emotions): string {
  return EMOTION_NAMES.filter((name) => emotions[name] >= 0.45).join(", ") || "quiet inside";
}

/** World minutes for a feeling to close most of the gap to where her needs point. */
export const FEELING_MINUTES = 20;
/** How far a need signal carries. Calm is held lower so that a met creature is not only ever calm. */
const REACH: Record<EmotionName, number> = { joy: 2, calm: 1.2, curiosity: 2, loneliness: 2, frustration: 2, pride: 2, boredom: 2, worry: 2 };

/**
 * Feelings settle toward what her needs point at, by the minute, and a moment adds on top and then fades.
 * The older blend added a share of the signal on every tick and kept 94 percent of the rest, so any steady
 * signal above about 0.17 ran to the ceiling and stayed there, and how fast depended on the tick.
 */
export function settleEmotions(emotions: Emotions, signals: Partial<Emotions>, impulse: Partial<Emotions>, minutes: number): Emotions {
  const next = { ...emotions };
  const share = 1 - Math.exp(-Math.max(0, minutes) / FEELING_MINUTES);
  for (const name of EMOTION_NAMES) {
    const target = clamp01((signals[name] ?? 0) * REACH[name]);
    next[name] = clamp01(next[name] + (target - next[name]) * share + (impulse[name] ?? 0));
  }
  return next;
}

/** What doing a thing leaves behind. Small, and smaller when the act has been repeated. */
export const ACT_FEELS: Record<string, Partial<Emotions>> = {
  paint: { pride: 0.3, joy: 0.12 },
  pulse_pattern: { pride: 0.18, joy: 0.1 },
  scrap_and_redo: { frustration: 0.25, pride: 0.1 },
  sulk: { frustration: 0.2, loneliness: 0.1 },
  show_gallery: { pride: 0.3 },
  call_out: { loneliness: 0.22 },
  approach_notes: { joy: 0.12 },
  light_show: { joy: 0.25 },
  dance: { joy: 0.3 },
  explore: { curiosity: 0.25 },
  inspect: { curiosity: 0.2 },
  forage: { curiosity: 0.15, joy: 0.08 },
  read_page: { curiosity: 0.25 },
  write_diary: { calm: 0.15, pride: 0.08 },
  rest: { calm: 0.12 },
  drift: { calm: 0.1, boredom: 0.08 },
  dim_lights: { calm: 0.15 },
  sleep: { calm: 0.1 },
};

export function actImpulse(action: string, scale: number): Partial<Emotions> {
  const out: Partial<Emotions> = {};
  for (const [name, value] of Object.entries(ACT_FEELS[action] ?? {})) out[name as EmotionName] = Math.round(value * Math.max(0, Math.min(1, scale)) * 10000) / 10000;
  return out;
}

/**
 * A rut makes her restless, once per act. Sized for feelings that fade over minutes: the older bumps were
 * sized for a feeling that lost 6 percent a tick, and on a slow fade they stacked to the ceiling. A rut of
 * boredom does not feed itself, or boredom would be the rut it complains about.
 */
export function restless(emotions: Emotions, recentActions: string[], recentDominant: EmotionName[]): Emotions {
  const next = { ...emotions };
  const acts = recentActions.slice(-4);
  if (acts.length === 4 && new Set(acts).size === 1) next.boredom = clamp01(next.boredom + 0.08);
  const moods = recentDominant.slice(-6);
  if (moods.length === 6 && new Set(moods).size <= 2 && moods[moods.length - 1] !== "boredom") next.boredom = clamp01(next.boredom + 0.05);
  return next;
}
