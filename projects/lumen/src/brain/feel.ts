import { clamp01, clampMood, type Needs, NEED_NAMES } from "./types";

/** Setbacks weigh this many times a win of the same magnitude. */
export const LOSS_WEIGHT = 7.5;

/** Need drift per world-minute. Higher means more needy. */
export const DRIFT_PER_MINUTE: Needs = {
  rest: 0.012,
  curiosity: 0.01,
  social: 0.009,
  expression: 0.011,
  quiet: 0.007,
};

export function driftNeeds(needs: Needs, minutes: number): Needs {
  const next = { ...needs };
  const span = Math.max(0, minutes);
  for (const name of NEED_NAMES) next[name] = clamp01(next[name] + DRIFT_PER_MINUTE[name] * span);
  return next;
}

/** Ambient pressures from the world. The world does not choose mood. */
export function applyForces(needs: Needs, sensors: { noise: number; brightness: number; visitorPresence: number }): Needs {
  const next = { ...needs };
  next.quiet = clamp01(next.quiet + sensors.noise * 0.02);
  next.rest = clamp01(next.rest + Math.max(0, sensors.brightness - 0.6) * 0.01);
  next.social = clamp01(next.social - sensors.visitorPresence * 0.015);
  next.quiet = clamp01(next.quiet + sensors.visitorPresence * 0.01);
  return next;
}

export function applyNeedDeltas(needs: Needs, deltas: Partial<Needs>, scale = 1): Needs {
  const next = { ...needs };
  for (const name of NEED_NAMES) {
    const delta = deltas[name];
    if (delta) next[name] = clamp01(next[name] + delta * scale);
  }
  return next;
}

/**
 * Mood shift from one outcome. Loss uses LOSS_WEIGHT. Decay is separate
 * so the asymmetry can be checked on its own.
 */
export function applyOutcome(mood: number, kind: "win" | "loss" | "neutral", magnitude: number): number {
  const mag = Math.max(0, magnitude);
  if (kind === "neutral" || mag === 0) return clampMood(mood);
  const signed = kind === "win" ? mag : -mag * LOSS_WEIGHT;
  return clampMood(mood + signed * 0.2);
}

export function decayMood(mood: number): number {
  return clampMood(mood * 0.985);
}

export function moodLabel(mood: number): "low" | "calm" | "positive" | "wired" {
  if (mood < -0.35) return "low";
  if (mood < 0.15) return "calm";
  if (mood < 0.65) return "positive";
  return "wired";
}

export function energyLabel(energy: number): "depleted" | "low" | "moderate" | "high" {
  if (energy < 0.18) return "depleted";
  if (energy < 0.4) return "low";
  if (energy < 0.75) return "moderate";
  return "high";
}

export function inboxStress(unread: number, quietNeed: number): number {
  return clamp01(unread * 0.08 + quietNeed * 0.25);
}
