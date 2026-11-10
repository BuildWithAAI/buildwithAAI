import type { PlaceId, Vec3 } from "./places";

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
  weather: "clear" | "rain" | "visitor" | "found-item";
  weatherText: string | null;
  places: { id: PlaceId; label: string; x: number; y: number; z: number }[];
  agents: PublicAgent[];
  feed: string[];
  diary: string[];
  log: string[];
  tune: { notes: number[]; title: string } | null;
  easel: { title: string; svg: string } | null;
  watchOnly: true;
};
