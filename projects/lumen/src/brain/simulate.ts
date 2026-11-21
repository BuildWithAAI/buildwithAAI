import { dominantEmotion } from "./emotions";
import { blankProduct, initialState, mulberry32, tick } from "./tick";
import { tideSummary } from "./tide";
import { NEED_NAMES, type BrainState } from "./types";

/**
 * Live her days fast, with no model, no network and no database. Same seed, same life.
 * This is how a change to the brain is checked over months before she lives it.
 */
export type SimReport = {
  days: number;
  ticks: number;
  /** Share of ticks spent on each act over the last tenth of the run. */
  lateActions: Record<string, number>;
  /** Share of ticks under each leading feeling over the last tenth of the run. */
  lateFeelings: Record<string, number>;
  /** Mean of the five needs over the last tenth of the run. 1 is fully unmet. */
  lateNeed: number;
  /** Share of long-term lines that are about a storm, in the old two-list memory. */
  legacyStormShare: number;
  /** Share of kept tidal lines (surface, shallows, pearls) that are about a storm. */
  tidalStormShare: number;
  tide: ReturnType<typeof tideSummary> | null;
  pearls: string[];
  state: BrainState;
};

export async function simulate(options: { days: number; seed?: number; stepMs?: number; tidal?: boolean; startMs?: number }): Promise<SimReport> {
  const stepMs = options.stepMs ?? 60_000;
  const tidal = options.tidal ?? true;
  const rng = mulberry32(options.seed ?? 1);
  const perDay = Math.floor(86_400_000 / stepMs);
  const total = perDay * options.days;
  const lateFrom = total - Math.max(1, Math.floor(total / 10));
  let state = initialState();
  let nowMs = options.startMs ?? Date.UTC(2027, 0, 1);
  const acts: Record<string, number> = {};
  const feelings: Record<string, number> = {};
  let needSum = 0;
  let late = 0;
  for (let step = 0; step < total; step += 1) {
    const result = await tick(state, {
      nowMs,
      elapsedMs: stepMs,
      rng,
      killLlm: true,
      modelConfigured: false,
      chatTriggered: false,
      webTextPresent: false,
      hasNewMessage: false,
      readAllowlist: [],
      ownerName: "keeper",
      product: blankProduct(),
      quietHours: false,
    });
    state = result.state;
    // The old brain, for comparison: with no tide on the state there is no day to roll over.
    if (!tidal) state = { ...state, tide: undefined };
    if (step >= lateFrom) {
      late += 1;
      acts[state.lastAction] = (acts[state.lastAction] ?? 0) + 1;
      const feeling = dominantEmotion(state.emotions);
      feelings[feeling] = (feelings[feeling] ?? 0) + 1;
      needSum += NEED_NAMES.reduce((sum, name) => sum + state.needs[name], 0) / NEED_NAMES.length;
    }
    nowMs += stepMs;
  }
  const share = (counts: Record<string, number>) => Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([key, count]) => [key, Math.round((count / late) * 1000) / 1000]));
  const stormy = (text: string) => /storm/i.test(text);
  const kept = state.tide ? [...state.tide.memories.filter((memory) => memory.layer < 2).map((memory) => memory.text), ...state.tide.pearls.map((pearl) => pearl.text)] : [];
  return {
    days: options.days,
    ticks: total,
    lateActions: share(acts),
    lateFeelings: share(feelings),
    lateNeed: Math.round((needSum / late) * 1000) / 1000,
    legacyStormShare: state.longTerm.length ? Math.round((state.longTerm.filter((memory) => stormy(memory.text)).length / state.longTerm.length) * 1000) / 1000 : 0,
    tidalStormShare: kept.length ? Math.round((kept.filter(stormy).length / kept.length) * 1000) / 1000 : 0,
    tide: state.tide ? tideSummary(state.tide) : null,
    pearls: state.tide ? state.tide.pearls.map((pearl) => `${pearl.feeling} @ ${pearl.placeId ?? "open water"}: ${pearl.text}`) : [],
    state,
  };
}
