import type { Needs } from "./types";

export const PROTOCOL = "lumen/1";

export type Place = { id: string; label: string; tags: string[] };

export const PLACES: Place[] = [
  { id: "still-pocket", label: "Still pocket", tags: ["rest", "quiet"] },
  { id: "lantern-arch", label: "Lantern arch", tags: ["social", "play"] },
  { id: "ink-studio", label: "Ink studio", tags: ["make"] },
  { id: "outer-current", label: "Outer current", tags: ["explore"] },
  { id: "glass-rim", label: "Glass rim", tags: ["social"] },
];

export type ActionName =
  | "rest"
  | "drift"
  | "dim_lights"
  | "explore"
  | "inspect"
  | "forage"
  | "approach_notes"
  | "light_show"
  | "paint"
  | "pulse_pattern"
  | "scrap_and_redo"
  | "sulk"
  | "show_gallery"
  | "call_out"
  | "dance"
  | "read_page"
  | "write_diary"
  | "sleep";

export type ActionDef = {
  name: ActionName;
  tags: string[];
  rest: boolean;
  makes: boolean;
  place: string | null;
  energy: number;
  feels: Partial<Needs>;
};

export const ACTIONS: ActionDef[] = [
  { name: "rest", tags: ["rest"], rest: true, makes: false, place: "still-pocket", energy: 0.06, feels: { rest: -0.18, quiet: -0.04 } },
  { name: "drift", tags: ["rest"], rest: true, makes: false, place: "outer-current", energy: 0.01, feels: { rest: -0.06, quiet: -0.05, curiosity: -0.02 } },
  { name: "dim_lights", tags: ["quiet", "rest"], rest: false, makes: false, place: "still-pocket", energy: 0.02, feels: { quiet: -0.16, rest: -0.04 } },
  { name: "explore", tags: ["curiosity"], rest: false, makes: false, place: "outer-current", energy: -0.04, feels: { curiosity: -0.16, rest: 0.03 } },
  { name: "inspect", tags: ["curiosity"], rest: false, makes: false, place: null, energy: -0.02, feels: { curiosity: -0.12 } },
  { name: "forage", tags: ["curiosity"], rest: false, makes: false, place: "outer-current", energy: -0.03, feels: { curiosity: -0.1, expression: 0.02 } },
  { name: "approach_notes", tags: ["social"], rest: false, makes: false, place: "glass-rim", energy: -0.02, feels: { social: -0.14, quiet: 0.04 } },
  { name: "light_show", tags: ["social", "expression"], rest: false, makes: false, place: "lantern-arch", energy: -0.05, feels: { social: -0.12, expression: -0.08, quiet: 0.06 } },
  { name: "paint", tags: ["expression"], rest: false, makes: true, place: "ink-studio", energy: -0.05, feels: { expression: -0.2, curiosity: -0.04, rest: 0.03 } },
  { name: "pulse_pattern", tags: ["expression"], rest: false, makes: true, place: "lantern-arch", energy: -0.04, feels: { expression: -0.14 } },
  { name: "scrap_and_redo", tags: ["expression"], rest: false, makes: true, place: "ink-studio", energy: -0.04, feels: { expression: -0.08, quiet: 0.02 } },
  { name: "sulk", tags: ["rest"], rest: true, makes: false, place: "still-pocket", energy: 0.01, feels: { rest: -0.04, social: 0.02 } },
  { name: "show_gallery", tags: ["social", "expression"], rest: false, makes: false, place: "lantern-arch", energy: -0.03, feels: { social: -0.1, expression: -0.06 } },
  { name: "call_out", tags: ["social"], rest: false, makes: false, place: "glass-rim", energy: -0.02, feels: { social: -0.08, quiet: 0.03 } },
  { name: "dance", tags: ["expression", "play"], rest: false, makes: false, place: "lantern-arch", energy: -0.06, feels: { expression: -0.1, social: -0.06, rest: 0.04 } },
  { name: "read_page", tags: ["curiosity"], rest: false, makes: false, place: "ink-studio", energy: -0.02, feels: { curiosity: -0.1 } },
  { name: "write_diary", tags: ["expression"], rest: false, makes: false, place: null, energy: -0.01, feels: { expression: -0.08, social: -0.03 } },
  { name: "sleep", tags: ["rest"], rest: true, makes: false, place: "still-pocket", energy: 0.12, feels: { rest: -0.25, quiet: -0.08 } },
];

export const ACTION_NAMES = new Set(ACTIONS.map((action) => action.name));

export function actionByName(name: string): ActionDef | undefined {
  return ACTIONS.find((action) => action.name === name);
}

export const INSPECT_TARGETS = ["glow-orb", "shell", "buoy", "studio-wall"] as const;

const REST_ONLY = new Set(["rest", "drift", "dim_lights", "sleep"]);

export function openActionNames(energy: number, readAllowed: boolean): ActionName[] {
  return ACTIONS.filter((action) => {
    if (energy < 0.18 && !REST_ONLY.has(action.name)) return false;
    if (action.name === "read_page" && !readAllowed) return false;
    return true;
  }).map((action) => action.name);
}

export function sensorsFromClock(worldMinute: number, visitorPresence: number): {
  noise: number;
  brightness: number;
  visitorPresence: number;
  tide: number;
  season: "spring" | "summer" | "autumn" | "winter";
  night: boolean;
  pressure: number;
} {
  const minute = ((worldMinute % 1440) + 1440) % 1440;
  const day = Math.floor(worldMinute / 1440);
  const night = minute < 5 * 60 || minute >= 20 * 60;
  const tide = (Math.sin((minute / 1440) * Math.PI * 2) + 1) / 2;
  const seasons = ["spring", "summer", "autumn", "winter"] as const;
  const season = seasons[Math.floor(((day % 360) + 360) % 360 / 90)] ?? "spring";
  const presence = clampPresence(visitorPresence);
  return {
    noise: presence * 0.55 + (night ? 0.02 : 0.12),
    brightness: night ? 0.16 : season === "summer" ? 0.78 : 0.62,
    visitorPresence: presence,
    tide,
    season,
    night,
    pressure: tide > 0.82 ? 0.74 : 0.22,
  };
}

function clampPresence(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

export function skillLabel(count: number): string {
  if (count >= 20) return "familiar";
  if (count >= 8) return "practiced";
  if (count >= 3) return "learning";
  return "new";
}
