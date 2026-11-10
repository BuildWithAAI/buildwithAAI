import type { Emotions, Needs } from "../brain/types";
import { PLACE_LABELS, type PlaceId } from "./places";

export type WorldActivity = "paint" | "study" | "hum" | "compose" | "write" | "read-log" | "greet" | "read-board";

const ACTS: Record<PlaceId, WorldActivity[]> = {
  "town-center": ["greet", "read-board"],
  "art-studio": ["paint", "study"],
  "music-studio": ["hum", "compose"],
  "coding-basement": ["write", "read-log"],
};

export function actsAt(place: PlaceId): WorldActivity[] {
  return ACTS[place];
}

export function isWorldActivity(place: PlaceId, action: string): action is WorldActivity {
  return (ACTS[place] as string[]).includes(action);
}

/**
 * The brain picks a room from needs and emotions.
 * Inspired -> art, calm or lonely -> music, curious -> basement, social -> town.
 */
export function chooseDestination(input: { needs: Needs; emotions: Emotions }): PlaceId {
  const scores: Record<PlaceId, number> = {
    "art-studio": input.needs.expression * 1.4 + input.emotions.pride * 0.8 + input.emotions.joy * 0.35,
    "music-studio": input.emotions.calm * 1.15 + input.emotions.loneliness * 1.05 + input.needs.quiet * 0.25,
    "coding-basement": input.needs.curiosity * 1.45 + input.emotions.curiosity * 0.9,
    "town-center": input.needs.social * 1.45 + input.emotions.loneliness * 0.15,
  };
  let best: PlaceId = "town-center";
  let bestScore = -Infinity;
  for (const id of ["town-center", "art-studio", "music-studio", "coding-basement"] as const) {
    if (scores[id] > bestScore) {
      best = id;
      bestScore = scores[id];
    }
  }
  return best;
}

export function activityFor(place: PlaceId, emotions: Emotions): { action: WorldActivity; label: string } {
  if (place === "art-studio") return { action: "paint", label: "painting at the easel" };
  if (place === "music-studio") {
    return emotions.loneliness > emotions.calm
      ? { action: "hum", label: "humming" }
      : { action: "compose", label: "composing a short phrase" };
  }
  if (place === "coding-basement") return { action: "write", label: "writing at the desk" };
  return { action: "read-board", label: "reading the notice board" };
}

export function walkingLabel(place: PlaceId): string {
  return `walking to ${PLACE_LABELS[place]}`;
}

/** Eight tones from a small original scale. Not a copied melody. */
export function composeTune(seed: number): { notes: number[]; title: string } {
  const scale = [262, 294, 330, 349, 392, 440, 494, 523];
  let state = (Math.abs(Math.floor(seed)) % 2147483646) + 1;
  const notes: number[] = [];
  for (let i = 0; i < 8; i += 1) {
    state = (state * 48271) % 2147483647;
    notes.push(scale[state % scale.length]!);
  }
  return { notes, title: "a small original phrase" };
}
