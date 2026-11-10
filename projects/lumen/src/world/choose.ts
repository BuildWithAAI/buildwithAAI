import type { Emotions, Needs } from "../brain/types";
import { AREAS, type AreaActivity } from "./areas";
import { PLACE_LABELS, type PlaceId } from "./places";

export type WorldActivity = AreaActivity;

const ACTS: Record<PlaceId, WorldActivity[]> = Object.fromEntries(AREAS.map((area) => [area.id, area.acts])) as Record<PlaceId, WorldActivity[]>;

export function actsAt(place: PlaceId): WorldActivity[] {
  return ACTS[place];
}

export function isWorldActivity(place: PlaceId, action: string): action is WorldActivity {
  return (ACTS[place] as string[]).includes(action);
}

/** The brain picks a room from the area config. Weights live next to the coordinates. */
export function chooseDestination(input: { needs: Needs; emotions: Emotions; workingOnIdea?: boolean }): PlaceId {
  let best: PlaceId = "town-center";
  let bestScore = -Infinity;
  for (const area of AREAS) {
    let score = 0;
    for (const [name, weight] of Object.entries(area.needs)) score += (input.needs[name as keyof Needs] ?? 0) * (weight ?? 0);
    for (const [name, weight] of Object.entries(area.emotions)) score += (input.emotions[name as keyof Emotions] ?? 0) * (weight ?? 0);
    if (area.id === "research-station" && input.workingOnIdea) score += 1.2;
    if (score > bestScore) {
      best = area.id;
      bestScore = score;
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
  if (place === "beach-dock") return { action: "gather", label: "looking for shells" };
  if (place === "forest-trail") return { action: "hike", label: "walking the trail" };
  if (place === "garden-greenhouse") return { action: "tend", label: "tending the beds" };
  if (place === "market-row") return { action: "show-art", label: "showing a piece, not selling it" };
  if (place === "lighthouse-hill") return { action: "lookout", label: "watching from the hill" };
  if (place === "research-station") return { action: "research", label: "researching an idea" };
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
