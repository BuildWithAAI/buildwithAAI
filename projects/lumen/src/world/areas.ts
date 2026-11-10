import type { EmotionName, NeedName } from "../brain/types";

export type AreaId =
  | "town-center"
  | "art-studio"
  | "music-studio"
  | "coding-basement"
  | "beach-dock"
  | "forest-trail"
  | "garden-greenhouse"
  | "market-row"
  | "lighthouse-hill"
  | "research-station";

export type AreaActivity =
  | "paint"
  | "study"
  | "hum"
  | "compose"
  | "write"
  | "read-log"
  | "greet"
  | "read-board"
  | "wade"
  | "gather"
  | "hike"
  | "rest-trail"
  | "tend"
  | "water-plants"
  | "browse"
  | "show-art"
  | "lookout"
  | "wonder"
  | "research"
  | "pin-finding";

export type AreaDef = {
  id: AreaId;
  label: string;
  x: number;
  y: number;
  z: number;
  acts: AreaActivity[];
  /** Weights are added. A place wins when its sum is the highest. */
  needs: Partial<Record<NeedName, number>>;
  emotions: Partial<Record<EmotionName, number>>;
};

/** Add a place here. Paths still meet at Town Center. Nothing in this list can spend. */
export const AREAS: AreaDef[] = [
  { id: "town-center", label: "Town Center", x: 0, y: 0.85, z: 0, acts: ["greet", "read-board"], needs: { social: 1.45 }, emotions: { loneliness: 0.15 } },
  { id: "art-studio", label: "Art Studio", x: 24, y: 0.85, z: 1, acts: ["paint", "study"], needs: { expression: 1.4 }, emotions: { pride: 0.8, joy: 0.35 } },
  { id: "music-studio", label: "Music Studio", x: 0, y: 0.85, z: 24, acts: ["hum", "compose"], needs: { quiet: 0.25 }, emotions: { calm: 1.15, loneliness: 1.05 } },
  { id: "coding-basement", label: "Coding Basement", x: -26, y: -1.15, z: 0, acts: ["write", "read-log"], needs: { curiosity: 1.45 }, emotions: { curiosity: 0.9 } },
  { id: "beach-dock", label: "Beach and dock", x: 52, y: 0.85, z: -6, acts: ["wade", "gather"], needs: { rest: 1.6 }, emotions: {} },
  { id: "forest-trail", label: "Forest trail", x: -48, y: 0.85, z: 40, acts: ["hike", "rest-trail"], needs: { rest: 1.1, quiet: 1.3 }, emotions: {} },
  { id: "garden-greenhouse", label: "Garden greenhouse", x: 22, y: 0.85, z: -36, acts: ["tend", "water-plants"], needs: {}, emotions: { calm: 1.4 } },
  { id: "market-row", label: "Market row", x: -36, y: 0.85, z: -28, acts: ["browse", "show-art"], needs: { social: 0.55 }, emotions: { pride: 1.25 } },
  { id: "lighthouse-hill", label: "Lighthouse hill", x: 6, y: 0.85, z: 58, acts: ["lookout", "wonder"], needs: { curiosity: 0.2 }, emotions: { curiosity: 1.2, calm: 0.9 } },
  { id: "research-station", label: "Research Station", x: -16, y: 0.85, z: -44, acts: ["research", "pin-finding"], needs: { curiosity: 0.35 }, emotions: { curiosity: 1.55 } },
];

export const AREA_IDS = AREAS.map((area) => area.id);

export function areaById(id: string): AreaDef | undefined {
  return AREAS.find((area) => area.id === id);
}
