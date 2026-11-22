import { rng } from "../form/genome";
import { checkInside, floorShape, layoutOf, type BuildingSpec } from "./building";
import type { Vec3 } from "./mesh";
import type { Part, Recipe } from "./recipe";
import type { RoadType } from "./roads";
import { floorInside, type InsideSpec, type InsideWall, type RoomMark } from "./rooms";

/**
 * Things she already knows how to make. None of them says where anything goes: that is hers to choose.
 * "plain", "fields" and "ruin" are land. The rest stand on land.
 *
 * Things she already knows how to start. Each one is written in the recipe language and nothing else,
 * so anything here she could have written herself, and she can change any of it. They are starting
 * points, not the limit: any recipe the forge accepts is something she may build.
 *
 * Every idea takes a seed, so no two towers or tracks she raises are the same.
 */

export const IDEA_KINDS = ["spire", "block", "exchange", "arch", "coaster", "tank", "tree", "lamp", "road", "plain", "fields", "ruin"] as const;
export const LAND_KINDS: readonly string[] = ["plain", "fields", "ruin"];
export type IdeaKind = (typeof IDEA_KINDS)[number];

const NAMES: Record<IdeaKind, [string[], string[]]> = {
  spire: [["Tide", "Lantern", "Salt", "Hollow", "Pale", "Deepwater"], ["Spire", "Shaft", "Needle", "Tower"]],
  exchange: [["Tidewater", "Brine", "Current", "Shoal", "Undertow"], ["Exchange", "Counting Hall", "Bourse", "Trading Hall"]],
  coaster: [["Riptide", "Eddy", "Whirl", "Surge", "Longshore"], ["Run", "Loop", "Rush", "Circuit"]],
  tank: [["Stillwater", "Glass", "Moon", "Drift", "Kelp"], ["Tank", "Bowl", "Aquarium", "Cistern"]],
  fields: [["Low", "Salt", "Quiet", "Green", "Far"], ["Fields", "Rows", "Acre", "Furrows"]],
  ruin: [["Dry", "Ash", "Lost", "Wind", "Bleached"], ["Waste", "Ruin", "Flats", "Remains"]],
  block: [["Brine", "Harbor", "Lamp", "Reef", "Narrow", "Upper"], ["Block", "Row", "Court", "Works", "House"]],
  plain: [["Open", "New", "Wide", "First", "Level"], ["Ground", "Quarter", "Reach", "Flat"]],
  arch: [["Tide", "Salt", "Low", "Lantern", "Kelp"], ["Gate", "Arch", "Passage", "Way"]],
  tree: [["Glass", "Slow", "Lamp", "Reef", "Pale"], ["Tree", "Frond", "Bloom"]],
  lamp: [["Small", "Street", "Soft", "Night"], ["Lamp", "Light", "Lantern"]],
  road: [["Long", "Shore", "Lamp", "Middle", "Quiet"], ["Road", "Street", "Way", "Lane"]],
};

const ROAD_NAMES: Record<RoadType, string[]> = { avenue: ["Avenue", "Parade", "Promenade"], street: ["Street", "Road", "Way"], alley: ["Alley", "Lane", "Passage", "Cut"] };

/** A name for a road of some kind. */
export function roadName(type: RoadType, next: () => number): string {
  const first = NAMES.road[0];
  return `${first[Math.floor(next() * first.length)]} ${ROAD_NAMES[type][Math.floor(next() * ROAD_NAMES[type].length)]}`;
}

/** The building with the inside she drew, if the forge would allow it, and as it was if not. */
function withInside(spec: BuildingSpec, inside: InsideSpec[]): BuildingSpec {
  if (!inside.length) return spec;
  try {
    checkInside({ ...spec, inside });
    return { ...spec, inside };
  } catch {
    return spec;
  }
}

/**
 * The plan of an ordinary block of flats, which she knows by heart: a hall from the front door to the
 * stairs at the back, and rooms to either side of it, each with a door onto the hall. The ground floor's
 * rooms are shops and the rooms above are homes, unless `use` says otherwise. `deep` is about how deep
 * she makes a room, and `strip` is how wide the rooms are, if she wants the hall wider than it need be.
 * A building too narrow for rooms beside its hall is left as it is.
 */
function hallRooms(spec: BuildingSpec, deep: number, use: { ground: "home" | "shop"; above: "home" | "shop" }, strip?: number): BuildingSpec {
  const plan = layoutOf(spec);
  const floors = plan.levels.length;
  const stairs = plan.stairs;
  // Her rooms have to fit the smallest floor, which is the top one if the building tapers.
  const top = floorShape(spec, floors - 1).rim;
  const [wide, front, back] = [Math.max(...top.map((p) => p[0])), Math.max(...top.map((p) => p[1])), Math.min(...top.map((p) => p[1]))];
  if ((spec.outline.shape ?? "block") !== "block" || !plan.door || plan.door.side !== 0 || (floors > 1 && !stairs)) return spec;
  // Only the plan with the stairs against the back wall, in the middle. The hall is a little wider than they are.
  if (stairs && (Math.abs(stairs.x) > 0.01 || stairs.z - stairs.hd - back > 0.6)) return spec;
  const hall = Math.max(stairs ? stairs.hw + 0.4 : 1.5, strip ? wide - strip : 0, (plan.door.m1 - plan.door.m0) / 2 + 0.5);
  if (wide - hall < 2.6) return spec;
  // A door onto the hall has to be in front of the stairs, where the hall is clear. The rooms at the back reach forward that far.
  const clearFrom = stairs ? stairs.z + stairs.hd + 0.9 : back + 0.9;
  const first = stairs ? clearFrom + 0.8 : back;
  const more = Math.max(stairs ? 0 : 1, Math.floor((front - first) / deep));
  if (!stairs && front - back < 2.6) return spec;
  // Where one room ends and the next begins, from the back wall to the front.
  const edges = [back, ...Array.from({ length: more }, (_, k) => first + ((front - first) * k) / more).filter((z) => z > back + 2.4), front];
  const [outer, long] = [(spec.outline.depth ?? spec.outline.width) / 2 + 1, (spec.outline.depth ?? spec.outline.width) + 2];
  const layout = (kind: "home" | "shop"): Omit<InsideSpec, "floors"> => {
    const walls: InsideWall[] = [];
    const rooms: RoomMark[] = [];
    for (const side of [-1, 1]) {
      const doors = edges.slice(0, -1).map((from, k) => {
        const to = edges[k + 1]!;
        // In the middle of the room's stretch of hall, or just in front of the stairs for a room beside them.
        const at = Math.min(to - 0.7, Math.max(Math.max(from + 0.7, clearFrom), (Math.max(from, clearFrom - 0.5) + to) / 2));
        return { at: (at + outer) / long };
      });
      walls.push({ from: [side * hall, -outer], to: [side * hall, outer], doors });
      for (const z of edges.slice(1, -1)) walls.push({ from: [side * hall, z], to: [side * (spec.outline.width / 2 + 1), z] });
      edges.slice(0, -1).forEach((from, k) => rooms.push({ at: [side * (hall + (wide - hall) / 2), (Math.max(from, back) + edges[k + 1]!) / 2], use: kind }));
    }
    return { walls, rooms };
  };
  return withInside(spec, [{ floors: [1, 1], ...layout(use.ground) }, ...(floors > 1 ? [{ floors: [2, floors] as [number, number], ...layout(use.above) }] : [])]);
}

/**
 * The plan of a slim tower or a narrow house: the stairs at the back, a wall across in front of them
 * with a door in it, and the rest of each floor one home. The ground floor is left open as the way in,
 * or is a shop with the stairs behind it if `ground` says so. A floor too small near the top for a
 * home is left open too.
 */
function landingRooms(spec: BuildingSpec, ground?: "shop"): BuildingSpec {
  const floors = layoutOf(spec).levels.length;
  if (floors < 2) return spec;
  const top = floorShape(spec, floors - 1).rim;
  const back = Math.min(...top.map((p) => p[1]));
  // The stairs as far back as a proper stair will go.
  let placed: BuildingSpec | null = null;
  for (let z = back + 0.6; z <= 0.001 && !placed; z += 0.2) {
    const tried = { ...spec, stairs: { at: [0, z] as [number, number] } };
    const found = layoutOf(tried).stairs;
    if (found && found.kind !== "ladder") placed = tried;
  }
  if (!placed) return spec;
  const stairs = layoutOf(placed).stairs!;
  const across = stairs.z + stairs.hd + 0.7 + 0.65;
  const reach = spec.outline.width / 2 + 1;
  const layout = (use: "home" | "shop"): Omit<InsideSpec, "floors"> => ({ walls: [{ from: [-reach, across], to: [reach, across], doors: [{ at: 0.5 }] }], rooms: [{ at: [0, across + 1.2], use }] });
  // The highest floor on which the home is still large enough.
  let last = floors - 1;
  while (last >= 1 && floorInside(floorShape(placed, last).rim, floorShape(placed, last).well, { floors: [1, 1], ...layout("home") }).problems.length) last -= 1;
  if (last < 1) return spec;
  const made = withInside(placed, [...(ground ? [{ floors: [1, 1] as [number, number], ...layout(ground) }] : []), { floors: [2, last + 1], ...layout("home") }]);
  return made.inside ? made : spec;
}

export function compose(kind: IdeaKind, seed: number): Recipe {
  const next = rng(seed ^ 0x2f6e2b1);
  const between = (low: number, high: number) => low + (high - low) * next();
  const whole = (low: number, high: number) => Math.round(between(low, high));
  const [first, second] = NAMES[kind];
  let name = `${first[Math.floor(next() * first.length)]} ${second[Math.floor(next() * second.length)]}`;
  const parts: Part[] = [];

  if (kind === "spire") {
    // One tall tapering tower she can walk into from the street and climb to the top, with her hand in its crown.
    const height = between(42, 78);
    const width = between(11, 14);
    const sides = whole(5, 8);
    const storey = between(3.2, 3.6);
    const floors = Math.round(height / storey);
    const taper = between(0.55, 0.75);
    parts.push({ op: "spin", material: "stone", outline: [[width * 0.9, 0], [width * 0.88, 0.15], [width * 0.78, 0.15], [width * 0.76, 0.3], [width * 0.6, 0.3]], ripple: 0.03 });
    parts.push({ op: "building", material: "glass", at: [0, 0.3, 0], outline: { shape: "sided", sides, width }, floors, floorHeight: storey, taper, roof: "flat", windows: { every: between(2.2, 2.8), width: 0.86, height: 0.72, sill: 0.1, lit: between(0.3, 0.7) }, door: { width: between(1.6, 2.2) } });
    parts.push({ op: "loft", material: "glass", at: [0, 0.4 + floors * storey, 0], up: height * between(0.1, 0.16), from: { shape: "sided", sides, width: width * taper * 0.8, soft: 0.4 }, taper: 0.25, bands: whole(1, 3), cap: "crown", segments: 48 });
    // Pinnacles to either side. None stands in front of the door.
    parts.push({ op: "loft", material: "stone", at: [0, 0, 0], up: height * between(0.3, 0.5), from: { shape: "sided", sides: 6, width: width * 0.3, soft: 0.4 }, taper: 0.5, bands: whole(2, 4), cap: "crown", around: { count: whole(2, 3), radius: width * 0.66 }, segments: 48 });
  }

  if (kind === "exchange") {
    // A trading hall on two shallow steps, with a row of columns across its front and a wide door between the middle two.
    const wide = between(24, 30);
    const deep = wide * 0.55;
    const tall = between(8, 11);
    parts.push({ op: "loft", material: "stone", up: 0.3, from: { shape: "block", width: wide + 6, depth: deep + 8, soft: 0.15 }, cap: "flat", hand: 0 });
    parts.push({ op: "building", material: "stone", at: [0, 0.3, 0], outline: { shape: "block", width: wide, depth: deep }, floors: 2, floorHeight: tall / 2, wall: 0.5, roof: "flat", windows: { every: between(2.6, 3.4), width: 0.5, height: 0.62, sill: 0.2, lit: 0.7 }, door: { width: 3.2, height: 3.4 } });
    const columns = whole(4, 5) * 2;
    const gap = (wide - 2) / (columns - 1);
    parts.push({ op: "loft", material: "metal", at: [-(wide - 2) / 2, 0.3, deep / 2 + 1.6], up: tall + 0.1, from: { shape: "round", width: 1.25, lobes: 12, ripple: 0.06 }, cap: "crown", repeat: { count: columns, step: [gap, 0, 0] }, mirror: "z", segments: 36 });
    parts.push({ op: "loft", material: "stone", at: [0, 0.4 + tall, 0], up: 2.4, from: { shape: "block", width: wide + 3, depth: deep + 6, soft: 0.1 }, taper: 0.72, cap: "flat", hand: 0 });
    parts.push({ op: "spin", material: "glass", at: [0, 2.8 + tall, 0], outline: [[deep * 0.34, 0], [deep * 0.36, 1.6], [deep * 0.3, 4], [deep * 0.16, 5.6], [0.05, 6.2]], ripple: 0.05 });
    const ring: Vec3[] = Array.from({ length: 12 }, (_, k) => [Math.cos((k / 12) * Math.PI * 2) * deep * 0.5, 0, Math.sin((k / 12) * Math.PI * 2) * deep * 0.5]);
    parts.push({ op: "loft", material: "glow", at: [0, 3.3 + tall, 0], through: ring, closed: true, from: { shape: "round", width: 0.35 }, segments: 8, rings: 72 });
  }

  if (kind === "coaster") {
    const points: Vec3[] = [];
    const turns = whole(2, 3);
    const phase = between(0, 6.28);
    const total = 14;
    for (let k = 0; k < total; k += 1) {
      const angle = (k / total) * Math.PI * 2;
      const r = 21 + 5 * Math.sin(angle * turns + phase);
      const y = 9 + 6.5 * Math.sin(angle * 2 + phase) + (k === 4 ? between(8, 14) : 0);
      points.push([Math.cos(angle) * r, Math.max(3, y), Math.sin(angle) * r]);
    }
    parts.push({ op: "loft", material: "metal", through: points, closed: true, from: { shape: "block", width: 2.6, depth: 0.45, soft: 0.6 }, rings: 180, segments: 12 });
    parts.push({ op: "loft", material: "glow", through: points.map(([x, y, z]) => [x, y + 0.42, z] as Vec3), closed: true, from: { shape: "round", width: 0.3 }, rings: 180, segments: 6 });
    for (let k = 0; k < total; k += 1) {
      const [x, y, z] = points[k]!;
      parts.push({ op: "loft", material: "stone", at: [x, 0, z], up: y - 0.5, from: { shape: "sided", sides: 6, width: 1.1, soft: 0.5 }, taper: 0.55, cap: "flat", segments: 18, rings: 6, hand: 0.5 });
    }
    parts.push({ op: "loft", material: "body", at: [0, 0, 0], up: between(10, 16), from: { shape: "round", width: 7, lobes: 10, ripple: 0.05 }, taper: 0.8, bands: 4, cap: "crown" });
  }

  if (kind === "tank") {
    const r = between(11, 14);
    const tall = between(20, 28);
    parts.push({ op: "spin", material: "stone", outline: [[r * 1.12, 0], [r * 1.14, 1.4], [r * 1.02, 2.2]], ripple: 0.05 });
    parts.push({ op: "spin", material: "water", at: [0, 2.2, 0], outline: [[r * 0.96, 0], [r * 1.14, tall * 0.3], [r * 1.14, tall * 0.62], [r * 0.9, tall * 0.84]], cap: "flat" });
    parts.push({ op: "spin", material: "glass", at: [0, 2.2, 0], outline: [[r, 0], [r * 1.2, tall * 0.3], [r * 1.2, tall * 0.66], [r * 0.92, tall * 0.9], [r * 0.8, tall]], cap: "top-open" });
    const lip: Vec3[] = Array.from({ length: 12 }, (_, k) => [Math.cos((k / 12) * Math.PI * 2) * r * 0.8, 0, Math.sin((k / 12) * Math.PI * 2) * r * 0.8]);
    parts.push({ op: "loft", material: "glow", at: [0, 2.2 + tall, 0], through: lip, closed: true, from: { shape: "round", width: 0.5 }, segments: 8, rings: 72 });
    for (let k = 0; k < 9; k += 1) {
      const a = next() * Math.PI * 2;
      const d = next() * r * 0.6;
      const reach = between(tall * 0.3, tall * 0.7);
      const sway = between(0.6, 1.6);
      parts.push({ op: "loft", material: "body", at: [Math.cos(a) * d, 2.4, Math.sin(a) * d], through: [[0, 0, 0], [sway, reach * 0.3, -sway * 0.5], [-sway, reach * 0.65, sway * 0.6], [sway * 0.4, reach, 0]], from: { shape: "round", width: 0.7 }, taper: 0.2, segments: 8, rings: 18 });
    }
    // Small bells adrift inside.
    parts.push({ op: "group", at: [0, 2.2 + tall * 0.55, 0], scatter: { count: whole(5, 9), spread: [r * 1.1, r * 1.1], size: [0.6, 1.3] }, parts: [{ op: "spin", material: "glow", outline: [[0.05, 0.9], [0.7, 0.6], [0.95, 0], [0.8, -0.1]], cap: "open", segments: 16 }] });
  }

  if (kind === "fields") {
    const wide = between(46, 56);
    parts.push({ op: "ground", material: "ground", width: wide, kind: "rows", relief: 0.7, rows: whole(12, 20), cells: 90, slab: 4 });
    parts.push({ op: "loft", material: "body", at: [0, 0.7, 0], up: 1.5, from: { shape: "round", width: 0.3 }, taper: 0.5, cap: "crown", segments: 8, rings: 3, scatter: { count: 130, spread: [wide * 0.62, wide * 0.62], size: [0.7, 1.6] } });
    parts.push({ op: "building", material: "stone", at: [-wide * 0.2, 0.3, wide * 0.12], outline: { shape: "block", width: 9, depth: 6.5 }, floors: 2, floorHeight: 3, roof: "flat", windows: { every: 3, lit: 0.3 }, door: { width: 1.4 } });
    parts.push({ op: "loft", material: "metal", at: [-wide * 0.2 + 7.5, 0.3, wide * 0.12 - 1], up: between(11, 15), from: { shape: "round", width: 3.6 }, bands: 3, cap: "crown" });
    const mast = between(13, 17);
    parts.push({ op: "loft", material: "stone", at: [wide * 0.22, 0.3, -wide * 0.16], up: mast, from: { shape: "sided", sides: 8, width: 2.4, soft: 0.5 }, taper: 0.45, cap: "crown", segments: 48 });
    for (let k = 0; k < 4; k += 1) parts.push({ op: "loft", material: "metal", at: [wide * 0.22, 0.3 + mast * 0.94, -wide * 0.16 + 1.5], roll: k * 90 + 20, up: 6.5, from: { shape: "block", width: 1.5, depth: 0.14, soft: 0.5 }, taper: 0.35, cap: "flat", hand: 0, segments: 12, rings: 4 });
  }

  if (kind === "ruin") {
    const wide = between(50, 58);
    parts.push({ op: "ground", material: "ground", width: wide, kind: "dunes", relief: between(1.6, 2.6), cells: 90, slab: 4 });
    parts.push({ op: "ground", material: "dark", at: [wide * 0.14, 0.05, wide * 0.1], width: 18, kind: "crater", relief: 2.4, round: true, cells: 40 });
    const stumps = whole(4, 6);
    for (let k = 0; k < stumps; k += 1) {
      const a = (k / stumps) * Math.PI * 2 + next();
      const d = between(6, wide * 0.3);
      parts.push({ op: "loft", material: "stone", at: [Math.cos(a) * d, -0.4, Math.sin(a) * d], tip: between(-16, 16), roll: between(-14, 14), up: between(7, 24), from: { shape: "sided", sides: whole(4, 7), width: between(3, 5.5), soft: 0.2 }, taper: between(0.5, 0.85), twist: between(-25, 25), cap: "open", hand: 0.5, bands: whole(0, 2), segments: 28, rings: 8 });
    }
    parts.push({ op: "loft", material: "stone", at: [0, 0.2, 0], up: 0.9, from: { shape: "block", width: 1.6, depth: 1.1, soft: 0.1 }, cap: "flat", hand: 0, segments: 12, rings: 2, scatter: { count: 60, spread: [wide * 0.6, wide * 0.6], size: [0.4, 1.8] } });
    parts.push({ op: "loft", material: "glow", at: [wide * 0.14, -1.4, wide * 0.1], up: between(9, 14), from: { shape: "sided", sides: 3, width: 0.9, soft: 0.1 }, taper: 0.1, twist: 60, cap: "flat", hand: 0, segments: 12 });
  }

  if (kind === "block") {
    // A few buildings of different heights along one kerb, the ordinary fabric of a town. Each has its own door on the front.
    const count = whole(1, 3);
    const lot = between(20, 30);
    parts.push({ op: "loft", material: "stone", up: 0.15, from: { shape: "block", width: lot, depth: lot * 0.8, soft: 0.08 }, cap: "flat" });
    for (let k = 0; k < count; k += 1) {
      const storey = between(3, 3.6);
      const floors = Math.max(2, Math.round(between(10, 44) / storey));
      const wide = (lot - 3) / count - 1;
      const deep = between(lot * 0.4, lot * 0.6);
      const x = -lot / 2 + 1.5 + wide / 2 + k * (wide + 1);
      const z = lot * 0.4 - deep / 2 - 1.3;
      const glassy = next() < 0.35;
      parts.push({ op: "building", material: glassy ? "glass" : "stone", at: [x, 0.15, z], outline: { shape: "block", width: wide, depth: deep }, floors, floorHeight: storey, taper: between(0.95, 1), roof: next() < 0.7 ? "parapet" : "flat", windows: { every: between(2.2, 3.4), width: glassy ? between(0.78, 0.9) : between(0.42, 0.66), height: glassy ? between(0.62, 0.75) : between(0.42, 0.58), sill: glassy ? 0.12 : between(0.26, 0.34), lit: between(0.25, 0.85) }, door: { width: between(1.2, 2.4) } });
      parts.push({ op: "loft", material: "dark", at: [x, 0.25 + floors * storey, z], up: between(0.8, 2.2), from: { shape: "block", width: wide * 0.4, depth: deep * 0.4, soft: 0.2 }, cap: "flat", segments: 16, rings: 2 });
    }
  }

  if (kind === "plain") {
    parts.push({ op: "ground", material: "ground", width: between(57, 63), depth: between(57, 63), kind: "flat", cells: 8, slab: 4 });
  }

  if (kind === "arch") {
    // A gate with a way cut through it: a hollow block with a hole in each long face.
    const wide = between(14, 20);
    const tall = between(9, 14);
    const mouth: [number, number] = [0, between(0.6, 0.72)];
    parts.push({ op: "loft", material: "stone", up: tall, from: { shape: "block", width: wide, depth: 5, soft: 0.12 }, wall: 1.1, bevel: 0.4, cap: "flat", segments: 64, rings: 24, openings: [{ along: mouth, around: [0.17, 0.33] }, { along: mouth, around: [0.67, 0.83] }] });
    parts.push({ op: "loft", material: "glow", at: [0, tall + 0.1, 0], up: 0.3, from: { shape: "block", width: wide * 0.8, depth: 0.5 }, cap: "flat", segments: 12, rings: 2 });
  }

  if (kind === "tree") {
    const tall = between(5, 10);
    parts.push({ op: "loft", material: "stone", up: tall, from: { shape: "sided", sides: 6, width: 0.9, soft: 0.6 }, taper: 0.45, twist: between(-40, 40), cap: "flat", segments: 12, rings: 6 });
    for (let k = 0; k < whole(2, 4); k += 1) parts.push({ op: "spin", material: k === 0 ? "body" : "glass", at: [between(-1.2, 1.2), tall * between(0.7, 1.05), between(-1.2, 1.2)], outline: [[0.1, between(1.6, 2.6)], [between(1.4, 2.6), 1], [between(1.8, 3), 0], [0.6, -0.5]], ripple: 0.08, segments: 20 });
  }

  if (kind === "lamp") {
    parts.push({ op: "loft", material: "metal", up: 4.6, from: { shape: "round", width: 0.3 }, taper: 0.6, cap: "flat", segments: 8, rings: 3 });
    parts.push({ op: "spin", material: "glow", at: [0, 4.6, 0], outline: [[0.05, 0.9], [0.45, 0.55], [0.5, 0], [0.2, -0.15]], segments: 12 });
  }

  if (kind === "road") {
    // A straight road of a kind and length drawn by chance. Where it goes is still hers to choose, and it must join her other roads.
    const draw = next();
    const type: RoadType = draw < 0.3 ? "alley" : draw < 0.85 ? "street" : "avenue";
    const half = between(20, 30);
    name = roadName(type, next);
    parts.push({ op: "road", type, through: [[-half, 0], [half, 0]] });
  }


  // Inside, she draws the rooms: shops on the ground floor of a block and homes above, shops down both sides of the trading hall, a home to each floor of a spire.
  // Those rooms are its homes and shops. Nothing she makes declares a home or a shop that is not a room, so a building too small for rooms has none.
  const roomed = parts.map((part): Part => {
    if (part.op !== "building") return part;
    if (kind === "block") {
      // A wide building has flats off a hall. A narrow one has a shop below and a home to each floor above.
      const flats = hallRooms(part, between(3.4, 5), { ground: "shop", above: "home" });
      return { ...part, ...(flats.inside ? flats : landingRooms(part, "shop")) };
    }
    if (kind === "exchange") return { ...part, ...hallRooms(part, between(4, 5), { ground: "shop", above: "shop" }, between(4.6, 6)) };
    if (kind === "spire") return { ...part, ...landingRooms(part) };
    return part;
  });
  return { name, seed: seed >>> 0, islet: false, layer: LAND_KINDS.includes(kind) ? "ground" : "structure", parts: roomed };
}
