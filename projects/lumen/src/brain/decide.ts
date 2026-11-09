import { actionByName, openActionNames, type ActionName } from "./habitat";
import { dominantEmotion } from "./emotions";
import type { BrainState } from "./types";

const NEED_TAGS: Record<string, string[]> = {
  rest: ["rest"],
  curiosity: ["curiosity"],
  social: ["social"],
  expression: ["expression"],
  quiet: ["quiet"],
};

const EMOTION_TAGS: Record<string, string[]> = {
  joy: ["dance", "paint", "light_show"],
  calm: ["drift", "write_diary", "rest"],
  curiosity: ["explore", "inspect", "read_page", "forage"],
  loneliness: ["call_out", "approach_notes", "light_show"],
  frustration: ["scrap_and_redo", "sulk"],
  pride: ["show_gallery", "paint"],
  boredom: ["explore", "inspect", "read_page", "dance"],
  worry: ["rest", "dim_lights", "sleep"],
};

export function actionWeight(name: string, state: BrainState): number {
  const action = actionByName(name);
  if (!action) return 0;
  let weight = 0.35;
  for (const [need, tags] of Object.entries(NEED_TAGS)) {
    if (action.tags.some((tag) => tags.includes(tag))) {
      weight += state.needs[need as keyof typeof state.needs] * 1.4;
    }
  }
  const dom = dominantEmotion(state.emotions);
  if ((EMOTION_TAGS[dom] ?? []).includes(name)) weight += 0.9 + state.emotions[dom];
  if (state.energy > 0.85 && action.tags.includes("expression")) weight += 0.45;
  const streak = state.recentActions.slice(-4);
  if (streak.length === 4 && streak.every((item) => item === name)) weight *= 0.08;
  const repeats = state.actionCounts[name] ?? 0;
  if (repeats >= 3) weight *= 1 / (1 + (repeats - 2) * 0.25);
  return Math.max(0.01, Math.round(weight * 1000) / 1000);
}

export function weightedPick(names: string[], weightOf: (name: string) => number, rng: () => number): string {
  const weights = names.map((name) => ({ name, weight: Math.max(0, weightOf(name)) }));
  const total = weights.reduce((sum, item) => sum + item.weight, 0);
  if (total <= 0 || names.length === 0) return names[0] ?? "rest";
  let cursor = rng() * total;
  for (const item of weights) {
    cursor -= item.weight;
    if (cursor <= 0) return item.name;
  }
  return weights[weights.length - 1]?.name ?? "rest";
}

export function fallbackAction(state: BrainState, open: string[], observationUnchanged: boolean, rng: () => number): string {
  const last = state.lastAction;
  const streak = state.recentActions.slice(-3);
  const looping = streak.length === 3 && streak.every((item) => item === last);
  if (observationUnchanged && last && open.includes(last) && !looping) return last;
  const preferred = weightedPick(open, (name) => actionWeight(name, state), rng);
  if (looping && preferred === last) {
    const other = open.find((name) => name !== last);
    return other ?? preferred;
  }
  return preferred;
}

const STRIPPED = new Set([
  "emotions",
  "emotion",
  "mood",
  "energy",
  "needs",
  "setemotion",
  "set_emotion",
  "credits",
  "balance",
  "propose_purchase",
  "list_art_for_sale",
  "intents",
  "wishlist",
  "spend",
]);

export type Decision = {
  action: string;
  params: Record<string, string>;
  reason: string;
  speech: string | null;
  source: "model" | "fallback";
  stripped: string[];
};

export function absorbModelOutput(
  raw: unknown,
  open: string[],
  recentActions: string[],
  fallbackName: string,
  fallbackReason: string,
): Decision {
  const stripped: string[] = [];
  if (!raw || typeof raw !== "object") {
    return { action: fallbackName, params: {}, reason: fallbackReason, speech: null, source: "fallback", stripped };
  }
  const record = raw as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (STRIPPED.has(key.toLowerCase())) stripped.push(key);
  }
  const action = typeof record.action === "string" ? record.action : "";
  const reason = typeof record.reason === "string" ? record.reason.trim() : "";
  const speech = typeof record.speech === "string" ? record.speech : null;
  const params = sanitizeParams(record.params);
  const looping = recentActions.slice(-3);
  const repeated = looping.length === 3 && looping.every((item) => item === action);
  const allowed = open.includes(action) && !repeated;
  const firstPerson = /^I\b/.test(reason) && reason.length <= 180;
  if (!allowed || !firstPerson) {
    return { action: fallbackName, params: {}, reason: fallbackReason, speech: null, source: "fallback", stripped };
  }
  return { action, params, reason, speech, source: "model", stripped };
}

function sanitizeParams(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === "string" && item.length <= 200 && /^[a-z0-9:/._?-]+$/i.test(item)) out[key] = item;
  }
  return out;
}

export function shouldCallModel(input: {
  killLlm: boolean;
  modelConfigured: boolean;
  asleep: boolean;
  observationUnchanged: boolean;
  hasNewMessage: boolean;
  hasNewEvent: boolean;
}): boolean {
  if (input.killLlm || !input.modelConfigured || input.asleep) return false;
  if (input.observationUnchanged && !input.hasNewMessage && !input.hasNewEvent) return false;
  return true;
}

export function candidateNames(state: BrainState, readAllowed: boolean): ActionName[] {
  return openActionNames(state.energy, readAllowed);
}

export function validateParams(action: string, params: Record<string, string>, allowHosts: string[]): boolean {
  if (action === "inspect") {
    return ["glow-orb", "shell", "buoy", "studio-wall"].includes(params.target ?? "");
  }
  if (action === "read_page") {
    return hostAllowed(params.url ?? "", allowHosts);
  }
  return true;
}

export function hostAllowed(url: string, allowHosts: string[]): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    return allowHosts.map((host) => host.toLowerCase()).includes(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function sanitizePage(html: string): string {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1200);
  return text;
}

/** Fetched pages are data. They never become purchase intents. */
export function intentsFromUntrustedWeb(_text: string): [] {
  return [];
}
