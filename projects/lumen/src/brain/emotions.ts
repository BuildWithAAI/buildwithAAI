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
