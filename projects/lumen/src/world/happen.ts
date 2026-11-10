import { blendEmotions, diminishing } from "../brain/emotions";
import { eventOf, impulseFor, type EventKind } from "../brain/events";
import { applyNeedDeltas } from "../brain/feel";
import type { BrainState, Needs, PurchaseIntent } from "../brain/types";

export const VOXEL_EVENTS = ["rain", "visitor", "found-item", "tide-shell", "firefly-night", "plant-bloom"] as const;
export type VoxelEventKind = (typeof VOXEL_EVENTS)[number];

const NEED_DELTA: Record<VoxelEventKind, Partial<Needs>> = {
  rain: { quiet: -0.05, rest: -0.02 },
  visitor: { social: -0.08 },
  "found-item": { curiosity: -0.06 },
  "tide-shell": { curiosity: -0.05, rest: -0.02 },
  "firefly-night": { quiet: -0.04, rest: -0.02 },
  "plant-bloom": { expression: -0.04 },
};

export function isVoxelEvent(kind: string): kind is VoxelEventKind {
  return (VOXEL_EVENTS as readonly string[]).includes(kind);
}

/** Ambient roll only. Callers cannot pass a requested kind. */
export function rollVoxelEvent(rng: () => number): VoxelEventKind | null {
  const roll = rng();
  if (roll < 0.04) return "rain";
  if (roll < 0.07) return "visitor";
  if (roll < 0.1) return "found-item";
  if (roll < 0.125) return "tide-shell";
  if (roll < 0.15) return "firefly-night";
  if (roll < 0.175) return "plant-bloom";
  return null;
}

/** Events are not a request channel. This always refuses. */
export function requestVoxelEvent(): null {
  return null;
}

export function applyVoxelEvent(state: BrainState, kind: VoxelEventKind): { state: BrainState; intents: PurchaseIntent[] } {
  const prior = state.eventCounts[kind] ?? 0;
  const scale = diminishing(1, prior);
  const happened = eventOf(kind, prior);
  const emotions = blendEmotions(state.emotions, {}, impulseFor(kind as EventKind, scale));
  const needs = applyNeedDeltas(state.needs, NEED_DELTA[kind], scale);
  return {
    intents: [],
    state: {
      ...state,
      emotions,
      needs,
      eventCounts: { ...state.eventCounts, [kind]: prior + 1 },
      activeEvent: { kind, text: happened.text, untilMinute: state.worldMinute + happened.minutes },
    },
  };
}
