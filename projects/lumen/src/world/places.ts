export const PLACE_IDS = ["town-center", "art-studio", "music-studio", "coding-basement"] as const;
export type PlaceId = (typeof PLACE_IDS)[number];

export type Vec3 = { x: number; y: number; z: number };

export const WALK_SPEED = 4;

/** Feet rest on the surface. The basement floor sits below the island. */
export const ANCHORS: Record<PlaceId, Vec3> = {
  "town-center": { x: 0, y: 0.85, z: 0 },
  "art-studio": { x: 24, y: 0.85, z: 1 },
  "music-studio": { x: 0, y: 0.85, z: 24 },
  "coding-basement": { x: -26, y: -1.15, z: 0 },
};

export const PLACE_LABELS: Record<PlaceId, string> = {
  "town-center": "Town Center",
  "art-studio": "Art Studio",
  "music-studio": "Music Studio",
  "coding-basement": "Coding Basement",
};

const STAND_OFFSETS: Vec3[] = [
  { x: 0, y: 0, z: 0 },
  { x: -1.3, y: 0, z: 0.7 },
  { x: 1.5, y: 0, z: -0.6 },
  { x: 0.2, y: 0, z: 1.4 },
];

export function isPlaceId(value: string): value is PlaceId {
  return (PLACE_IDS as readonly string[]).includes(value);
}

export function standAt(place: PlaceId, slot: number): Vec3 {
  const anchor = ANCHORS[place];
  const offset = STAND_OFFSETS[Math.abs(slot) % STAND_OFFSETS.length] ?? STAND_OFFSETS[0]!;
  return { x: anchor.x + offset.x, y: anchor.y + offset.y, z: anchor.z + offset.z };
}

export function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

export function pathLength(path: Vec3[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i += 1) total += distance(path[i - 1]!, path[i]!);
  return total;
}

/** Walk time at WALK_SPEED. A zero-length path arrives immediately. */
export function travelMs(path: Vec3[]): number {
  return Math.round((pathLength(path) / WALK_SPEED) * 1000);
}

export function placeAt(path: Vec3[], departAt: number, arriveAt: number, now: number): Vec3 {
  if (!path.length) return { ...ANCHORS["town-center"] };
  if (now <= departAt || path.length === 1) return { ...path[0]! };
  if (now >= arriveAt) return { ...path[path.length - 1]! };
  const total = pathLength(path);
  const span = Math.max(1, arriveAt - departAt);
  let remain = total * ((now - departAt) / span);
  for (let i = 1; i < path.length; i += 1) {
    const step = distance(path[i - 1]!, path[i]!);
    if (remain <= step || i === path.length - 1) {
      const t = step === 0 ? 0 : Math.min(1, remain / step);
      return lerp(path[i - 1]!, path[i]!, t);
    }
    remain -= step;
  }
  return { ...path[path.length - 1]! };
}

function segment(a: Vec3, b: Vec3, step = 2): Vec3[] {
  const dist = distance(a, b);
  const count = Math.max(1, Math.ceil(dist / step));
  const points: Vec3[] = [];
  for (let i = 1; i <= count; i += 1) points.push(lerp(a, b, i / count));
  return points;
}

/** Routes go through Town Center unless one end is already the hub. */
export function routePlaces(from: PlaceId, to: PlaceId): PlaceId[] {
  if (from === to) return [from];
  if (from === "town-center" || to === "town-center") return [from, to];
  return [from, "town-center", to];
}

export function pathBetween(from: Vec3, to: PlaceId, slot = 0): Vec3[] {
  const goal = standAt(to, slot);
  const startPlace = nearestPlace(from);
  const stops = routePlaces(startPlace, to);
  const points: Vec3[] = [{ ...from }];
  const anchors = stops.map((place, index) => (index === stops.length - 1 ? goal : { ...ANCHORS[place] }));
  if (stops[0] === startPlace) anchors[0] = { ...from };
  for (let i = 0; i < anchors.length; i += 1) {
    const next = anchors[i]!;
    const prev = points[points.length - 1]!;
    if (distance(prev, next) < 0.05) continue;
    if (i === 0 && stops.length > 1 && distance(prev, ANCHORS[stops[0]!] ?? prev) < 0.05) continue;
    points.push(...segment(prev, next));
  }
  if (distance(points[points.length - 1]!, goal) > 0.05) points.push(goal);
  return points;
}

export function nearestPlace(point: Vec3): PlaceId {
  let best: PlaceId = "town-center";
  let bestDist = Infinity;
  for (const id of PLACE_IDS) {
    const dist = distance(point, ANCHORS[id]);
    if (dist < bestDist) {
      best = id;
      bestDist = dist;
    }
  }
  return best;
}
