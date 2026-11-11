import { proposeAddendum, templateAddendum, LOCKED_LINES } from "./character";
import { dominantEmotion, feelingSentence } from "./emotions";
import type { Attraction, BrainState, Memory, Verdict } from "./types";

export const SHORT_CAP = 24;
export const LONG_CAP = 24;

export function remember(state: BrainState, memory: Memory): BrainState {
  const shortTerm = [...state.shortTerm, memory]
    .sort((a, b) => b.salience - a.salience || b.atMinute - a.atMinute)
    .slice(0, SHORT_CAP);
  return { ...state, shortTerm };
}

export function updateVerdict(current: Verdict, evidence: "like" | "dislike"): Verdict {
  const dir = evidence === "like" ? 1 : -1;
  const weight = Math.round(Math.min(1, Math.max(-1, current.weight + dir * 0.15)) * 10000) / 10000;
  return { subject: current.subject, weight, stance: weight >= 0 ? "like" : "dislike" };
}

export function decayAttractions(list: Attraction[]): Attraction[] {
  return list
    .map((item) => ({ ...item, strength: Math.round(item.strength * 0.5 * 10000) / 10000 }))
    .filter((item) => item.strength > 0.02);
}

export function morningPage(state: BrainState): string {
  const feel = feelingSentence(state.emotions, state.mood, state.energy, state.stress);
  return `Private morning page. Not for the feed. ${feel} Dominant: ${dominantEmotion(state.emotions)}.`;
}

/** Sleep consolidates. Locked sheet lines are not in this function's write set. */
export function consolidate(state: BrainState): BrainState {
  const promoted = state.shortTerm.filter((memory) => memory.salience >= 0.55);
  const longTexts = new Set(state.longTerm.map((memory) => memory.text));
  const additions = promoted.filter((memory) => !longTexts.has(memory.text)).map((memory) => ({ ...memory, tier: "long" as const }));
  const longTerm = [...state.longTerm, ...additions]
    .sort((a, b) => b.salience - a.salience || b.atMinute - a.atMinute)
    .slice(0, LONG_CAP);
  const promotedText = new Set(additions.map((memory) => memory.text));
  const shortTerm = state.shortTerm.filter((memory) => !promotedText.has(memory.text)).slice(0, SHORT_CAP);
  const draft = templateAddendum(state.stress, state.emotions.pride);
  const addenda = [...state.addenda];
  if (draft && addenda.length < 8) {
    const judged = proposeAddendum(draft);
    if (judged.ok && !addenda.includes(judged.text)) addenda.push(judged.text);
  }
  const page = morningPage(state);
  return {
    ...state,
    shortTerm,
    longTerm,
    addenda,
    attractions: decayAttractions(state.attractions),
    morningPages: [...state.morningPages, page].slice(-8),
    asleep: false,
    sleepOwed: Math.max(0, Math.round((state.sleepOwed - 0.5) * 1000) / 1000),
  };
}

export function carryingInView(state: BrainState): BrainState["carrying"] {
  return state.carrying.filter((item) => item.status === "open" && item.placeId === state.placeId);
}

export function observationHash(state: BrainState): string {
  const needs = Object.entries(state.needs)
    .map(([key, value]) => `${key}:${Math.round(value * 10)}`)
    .join(",");
  return [state.placeId, state.activeEvent?.kind ?? "none", state.unread, needs].join("|");
}

export function lockedLines(): readonly string[] {
  return LOCKED_LINES;
}
