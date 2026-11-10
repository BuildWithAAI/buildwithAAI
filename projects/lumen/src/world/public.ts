import type { PlaceId, Vec3 } from "./places";
import type { SkyState } from "./sky";

export type PublicAgent = {
  id: string;
  name: string;
  color: string;
  x: number;
  y: number;
  z: number;
  path: Vec3[];
  departAt: number | null;
  arriveAt: number | null;
  placeId: string;
  destPlace: string | null;
  activity: string;
  speech: string;
  feeling: string;
  walking: boolean;
};

export type PublicWorld = {
  now: number;
  night: boolean;
  sky: SkyState;
  weather: "clear" | "rain" | "visitor" | "found-item" | "tide-shell" | "firefly-night" | "plant-bloom";
  gardenGrowth: number;
  weatherText: string | null;
  places: { id: PlaceId; label: string; x: number; y: number; z: number }[];
  agents: PublicAgent[];
  feed: string[];
  wishlist: string[];
  diary: string[];
  log: string[];
  tune: { notes: number[]; title: string } | null;
  easel: { title: string; svg: string } | null;
  research: { idea: string | null; question: string; pins: string[] };
  builds: { id: string; kind: string; title: string; x: number; z: number; size: number; yaw: number; version: number; hue: number; parts: number; twist: number; form: number }[];
  shop: { name: string; hue: number; form: number; x: number; z: number; open: boolean } | null;
  tape: { mode: "PAPER" | "LIVE"; lines: string[] };
  watchOnly: true;
};
