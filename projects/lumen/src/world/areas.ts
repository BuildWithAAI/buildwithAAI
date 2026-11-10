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

/** A slot beside the building, off the path to Town Center. dx/dz are offsets from the place anchor. */
export type BuildSlot = { dx: number; dz: number };

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
  /** Where Zoora may set a build. Empty means the place has no build zone. */
  buildSlots: BuildSlot[];
};

function sideSlots(x: number, z: number, paths: { x: number; z: number }[]): BuildSlot[] {
  const len = Math.hypot(x, z) || 1;
  const px = -z / len;
  const pz = x / len;
  const candidates: BuildSlot[] = [];
  for (const dist of [3.2, 4.4, 5.6, 6.8]) {
    for (const turn of [0, 0.5, -0.5, 1, -1]) {
      const ox = px * Math.cos(turn) - pz * Math.sin(turn);
      const oz = px * Math.sin(turn) + pz * Math.cos(turn);
      candidates.push({ dx: ox * dist, dz: oz * dist });
      candidates.push({ dx: -ox * dist - (x / len) * 1.6, dz: -oz * dist - (z / len) * 1.6 });
    }
  }
  return candidates.filter((slot) => pointClear(x + slot.dx, z + slot.dz, x, z, paths)).slice(0, 3);
}

function pointClear(x: number, z: number, ax: number, az: number, paths: { x: number; z: number }[]): boolean {
  if (Math.hypot(x - ax, z - az) < 2.3) return false;
  for (const path of paths) {
    if (segmentDistance(x, z, 0, 0, path.x, path.z) < 1.7) return false;
  }
  if (Math.hypot(ax, az) > 40) {
    const len = Math.hypot(ax, az) || 1;
    const outward = ((x - ax) * ax + (z - az) * az) / len;
    if (outward > 0.8) return false;
  }
  return true;
}

function segmentDistance(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const abx = bx - ax;
  const abz = bz - az;
  const ab2 = abx * abx + abz * abz;
  const t = ab2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * abx + (pz - az) * abz) / ab2));
  return Math.hypot(px - (ax + abx * t), pz - (az + abz * t));
}

const AREA_SEED: Omit<AreaDef, "buildSlots">[] = [
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

const PATHS = AREA_SEED.filter((area) => area.id !== "town-center").map((area) => ({ x: area.x, z: area.z }));

function townSlots(): BuildSlot[] {
  const mids = [43, 115, -32].map((deg) => {
    const rad = (deg * Math.PI) / 180;
    return { dx: Math.cos(rad) * 6.5, dz: Math.sin(rad) * 6.5 };
  });
  return mids.filter((slot) => pointClear(slot.dx, slot.dz, 0, 0, PATHS));
}

/** Add a place here. Paths still meet at Town Center. Nothing in this list can spend. */
export const AREAS: AreaDef[] = AREA_SEED.map((area) => ({
  ...area,
  buildSlots: area.id === "town-center" ? townSlots() : sideSlots(area.x, area.z, PATHS),
}));

export const AREA_IDS = AREAS.map((area) => area.id);

export function areaById(id: string): AreaDef | undefined {
  return AREAS.find((area) => area.id === id);
}
