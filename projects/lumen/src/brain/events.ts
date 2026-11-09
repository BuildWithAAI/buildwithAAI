import { diminishing } from "./emotions";

export type EventKind =
  | "tide-low"
  | "tide-high"
  | "dawn"
  | "dusk"
  | "storm"
  | "calm-rain"
  | "lost-shell"
  | "fish-school"
  | "plankton-bloom"
  | "tool-break"
  | "glass-buoy"
  | "moon-path";

export type WorldEvent = {
  kind: EventKind;
  text: string;
  outcome: "win" | "loss" | "neutral";
  magnitude: number;
  minutes: number;
};

const COPY: Record<EventKind, Omit<WorldEvent, "kind">> = {
  "tide-low": { text: "The tide pulled back and left the rocks shining.", outcome: "neutral", magnitude: 0, minutes: 30 },
  "tide-high": { text: "The tide rose and the arch hummed.", outcome: "neutral", magnitude: 0, minutes: 30 },
  dawn: { text: "Dawn put a pale seam on the bowl.", outcome: "win", magnitude: 0.03, minutes: 20 },
  dusk: { text: "Dusk folded the bowl into blue.", outcome: "neutral", magnitude: 0.02, minutes: 20 },
  storm: { text: "A storm raked the surface. I held the still pocket.", outcome: "loss", magnitude: 0.08, minutes: 40 },
  "calm-rain": { text: "Rain ticked on the water, small and even.", outcome: "win", magnitude: 0.03, minutes: 25 },
  "lost-shell": { text: "A lost shell washed into the rim.", outcome: "win", magnitude: 0.08, minutes: 20 },
  "fish-school": { text: "A school of silver fish stitched past the arch.", outcome: "win", magnitude: 0.08, minutes: 15 },
  "plankton-bloom": { text: "Plankton bloomed and the bowl filled with slow sparks.", outcome: "win", magnitude: 0.08, minutes: 25 },
  "tool-break": { text: "The studio reed snapped. The line I wanted is gone.", outcome: "loss", magnitude: 0.08, minutes: 20 },
  "glass-buoy": { text: "The tide set a glass buoy in the bowl, and the loop I was stuck on went quiet.", outcome: "win", magnitude: 0.05, minutes: 30 },
  "moon-path": { text: "A rare moon-path lay across the rim like a drawn line.", outcome: "win", magnitude: 0.06, minutes: 20 },
};

export function eventOf(kind: EventKind, prior = 0): WorldEvent {
  const base = COPY[kind];
  return { kind, ...base, magnitude: diminishing(base.magnitude, prior) };
}

export function clockEvent(prevMinute: number, nextMinute: number): WorldEvent | null {
  const prev = ((prevMinute % 1440) + 1440) % 1440;
  const next = ((nextMinute % 1440) + 1440) % 1440;
  const crossed = (mark: number) => prev < mark && next >= mark;
  if (crossed(5 * 60)) return eventOf("dawn");
  if (crossed(20 * 60)) return eventOf("dusk");
  if (crossed(2 * 60)) return eventOf("tide-low");
  if (crossed(14 * 60)) return eventOf("tide-high");
  return null;
}

/** Seeded ambient rolls. Fixation events are scheduled by the brain, not banned words. */
export function rollAmbient(rng: () => number, scheduled: EventKind | null, prior: Record<string, number>): WorldEvent | null {
  if (scheduled) return eventOf(scheduled, prior[scheduled] ?? 0);
  const roll = rng();
  const table: { below: number; kind: EventKind }[] = [
    { below: 0.012, kind: "storm" },
    { below: 0.03, kind: "fish-school" },
    { below: 0.048, kind: "lost-shell" },
    { below: 0.064, kind: "plankton-bloom" },
    { below: 0.076, kind: "tool-break" },
    { below: 0.09, kind: "calm-rain" },
    { below: 0.098, kind: "moon-path" },
  ];
  for (const row of table) {
    if (roll < row.below) return eventOf(row.kind, prior[row.kind] ?? 0);
  }
  return null;
}

export function impulseFor(kind: EventKind, scale: number): Partial<Record<"joy" | "calm" | "curiosity" | "loneliness" | "frustration" | "pride" | "boredom" | "worry", number>> {
  const s = scale;
  switch (kind) {
    case "storm":
      return { worry: 0.35 * s, calm: -0.1 * s };
    case "tool-break":
      return { frustration: 0.32 * s, pride: -0.05 * s };
    case "fish-school":
      return { curiosity: 0.16 * s, joy: 0.1 * s };
    case "plankton-bloom":
      return { joy: 0.22 * s, curiosity: 0.08 * s };
    case "lost-shell":
      return { curiosity: 0.14 * s };
    case "glass-buoy":
      return { calm: 0.2 * s, boredom: -0.25 * s, curiosity: 0.05 * s };
    case "dawn":
      return { calm: 0.08 * s };
    case "moon-path":
      return { pride: 0.12 * s, joy: 0.1 * s };
    default:
      return { calm: 0.04 * s };
  }
}
