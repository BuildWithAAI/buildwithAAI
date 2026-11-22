import { emptyMesh, MATERIALS, place, triangle, vertex, type MaterialName, type Mesh, type Vec3 } from "./mesh";

/**
 * Her building tool.
 *
 * A building made with it is one she can walk into. Its walls have thickness. Its floors are real
 * floors. Its door is an opening with leaves that stand open, and its windows are openings with a
 * frame, a sill and a pane of glass. Stairs join every floor to the one above.
 *
 * The tool chooses nothing. The outline, the number of floors, how tall each is, how thick the walls
 * are, how the windows are spaced and sized, where the door is and how wide, and where the stairs
 * stand are all hers. What it adds is the care a builder takes: a sill under each window, a canopy
 * and a step at the door, a rail round the stairwell, a coping and a line of her light at the roof.
 *
 * One layout is worked out from her numbers. The mesh is built from it, and so is the plan the
 * live world uses to let someone walk inside, so the two cannot disagree.
 */

export const BUILDING = {
  /** Most storeys, and the least, most and usual height of one, in metres. */
  floors: 60,
  floorHeight: [2.6, 8, 3.2],
  wall: [0.2, 1.2, 0.3],
  /** How thick a floor is, and how far the ground floor's surface is above the build's base. */
  slab: 0.25,
  base: 0.1,
  /** How far the wall rises above the roof: a full parapet, or a low kerb on a flat roof. */
  parapet: 0.9,
  kerb: 0.25,
  /** Stairs: the most one step rises, how deep a step is, and how wide a flight is. */
  riser: 0.175,
  tread: 0.28,
  flight: 1.1,
} as const;

export type BuildingSpec = {
  /** The footprint. A block is a rectangle, sided has 3 to 16 straight sides, and round has 8 to 24, more the larger it is. */
  outline: { shape?: "block" | "sided" | "round"; width: number; depth?: number; sides?: number };
  floors: number;
  floorHeight?: number;
  wall?: number;
  /** The size of the top as a share of the base. */
  taper?: number;
  /** `every` is the width of a bay in metres. `width`, `height` and `sill` are shares of the bay and of the storey. `lit` is the share of panes that glow. */
  windows?: { every?: number; width?: number; height?: number; sill?: number; lit?: number } | false;
  /** `side` counts walls from the front, which faces +z. `at` is how far along that wall, 0 to 1. */
  door?: { side?: number; at?: number; width?: number; height?: number } | false;
  roof?: "flat" | "parapet";
  stairs?: { at?: [number, number] } | false;
};

type P2 = [number, number];
type Opening = { m0: number; m1: number; y0: number; y1: number; door: boolean; lit: boolean };
type Wall = { a: P2; e: P2; n: P2; long: number; in0: number; in1: number; openings: Opening[] };
export type Stairs = { kind: "flights" | "spiral" | "ladder"; x: number; z: number; /** Half the stairwell's size across and front to back. */ hw: number; hd: number };
export type Layout = {
  outer: P2[];
  inner: P2[];
  walls: Wall[];
  floorHeight: number;
  wall: number;
  /** The height of each floor's surface, ground floor first. */
  levels: number[];
  /** The roof deck, and the top of the wall. */
  top: number;
  wallTop: number;
  taper: number;
  door: { side: number; m0: number; m1: number; height: number } | null;
  stairs: Stairs | null;
};

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const id = (name: MaterialName) => MATERIALS.indexOf(name);

function footprint(outline: BuildingSpec["outline"]): P2[] {
  const wide = outline.width;
  const deep = outline.depth ?? wide;
  if ((outline.shape ?? "block") === "block") return [[-wide / 2, deep / 2], [wide / 2, deep / 2], [wide / 2, -deep / 2], [-wide / 2, -deep / 2]];
  // A round building has as many straight walls as leaves each wide enough for a door: eight for a small one, twenty-four for a large.
  const sides = outline.shape === "round" ? clamp(Math.round((Math.PI * Math.min(wide, deep)) / 2.2), 8, 24) : clamp(Math.round(outline.sides ?? 6), 3, 16);
  // The first wall faces the front, and the rest follow the same way round as a block's.
  return Array.from({ length: sides }, (_, i) => {
    const angle = Math.PI / 2 + Math.PI / sides - (i * 2 * Math.PI) / sides;
    return [(Math.cos(angle) * wide) / 2, (Math.sin(angle) * deep) / 2] as P2;
  });
}

/** Whether a point is inside a shape with no dents, with `margin` to spare. */
function within(shape: P2[], x: number, z: number, margin = 0): boolean {
  let sign = 0;
  for (let i = 0; i < shape.length; i += 1) {
    const [a, b] = [shape[i]!, shape[(i + 1) % shape.length]!];
    const far = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const side = ((b[0] - a[0]) * (z - a[1]) - (b[1] - a[1]) * (x - a[0])) / far;
    if (Math.abs(side) < margin) return false;
    if (sign === 0) sign = Math.sign(side);
    else if (Math.sign(side) !== sign) return false;
  }
  return true;
}

/** Everything about the building that follows from her numbers: where each wall, opening, floor and stair is. */
export function layoutOf(spec: BuildingSpec, next: () => number = () => 1): Layout {
  const floorHeight = clamp(spec.floorHeight ?? BUILDING.floorHeight[2], BUILDING.floorHeight[0], BUILDING.floorHeight[1]);
  const floors = clamp(Math.round(spec.floors), 1, Math.min(BUILDING.floors, Math.floor(136 / floorHeight)));
  const wall = clamp(spec.wall ?? BUILDING.wall[2], BUILDING.wall[0], BUILDING.wall[1]);
  const taper = clamp(spec.taper ?? 1, 0.5, 1);
  const outer = footprint(spec.outline);
  const count = outer.length;
  const edges = outer.map((a, i) => {
    const b = outer[(i + 1) % count]!;
    const long = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const e: P2 = [(b[0] - a[0]) / long, (b[1] - a[1]) / long];
    let n: P2 = [-e[1], e[0]];
    if (n[0] * (a[0] + b[0]) + n[1] * (a[1] + b[1]) < 0) n = [e[1], -e[0]];
    return { a, e, n, long };
  });
  // The inside face of each wall: every side moved in by the wall's thickness.
  const inner = outer.map((a, i) => {
    const [before, after] = [edges[(i + count - 1) % count]!.n, edges[i]!.n];
    const det = before[0] * after[1] - before[1] * after[0];
    return [a[0] - (wall * (after[1] - before[1])) / det, a[1] - (wall * (before[0] - after[0])) / det] as P2;
  });
  const levels = Array.from({ length: floors }, (_, k) => BUILDING.base + k * floorHeight);
  const top = BUILDING.base + floors * floorHeight;
  const wallTop = top + (spec.roof === "flat" ? BUILDING.kerb : BUILDING.parapet);
  const walls: Wall[] = edges.map((edge, i) => {
    const [q0, q1] = [inner[i]!, inner[(i + 1) % count]!];
    const along = (p: P2) => (p[0] - edge.a[0]) * edge.e[0] + (p[1] - edge.a[1]) * edge.e[1];
    return { ...edge, in0: along(q0), in1: along(q1), openings: [] };
  });

  // The door, on the wall she chose, or on the longest wall if hers is too short for one.
  let door: Layout["door"] = null;
  if (spec.door !== false) {
    const asked = walls[clamp(Math.round(spec.door?.side ?? 0), 0, count - 1)]!;
    const longest = [...walls].sort((p, q) => q.in1 - q.in0 - (p.in1 - p.in0))[0]!;
    const on = asked.in1 - asked.in0 >= 1.7 ? asked : longest;
    const room = on.in1 - on.in0;
    if (room >= 1.7) {
      const width = clamp(spec.door?.width ?? 1.6, 0.9, Math.min(6, room - 0.8));
      const height = clamp(spec.door?.height ?? 2.4, 2, Math.min(5, floorHeight - BUILDING.slab - 0.15));
      const mid = clamp(on.in0 + room * clamp(spec.door?.at ?? 0.5, 0, 1), on.in0 + 0.4 + width / 2, on.in1 - 0.4 - width / 2);
      door = { side: walls.indexOf(on), m0: mid - width / 2, m1: mid + width / 2, height };
      on.openings.push({ m0: door.m0, m1: door.m1, y0: levels[0]!, y1: levels[0]! + height, door: true, lit: false });
    }
  }

  // Windows: each wall is split into bays, and each bay on each storey has one.
  if (spec.windows !== false) {
    const every = clamp(spec.windows?.every ?? 3, 1.2, 12);
    const share = clamp(spec.windows?.width ?? 0.55, 0.2, 0.92);
    const tall = clamp(spec.windows?.height ?? 0.5, 0.2, 0.85);
    const sill = clamp(spec.windows?.sill ?? 0.3, 0.05, 0.6);
    const lit = clamp(spec.windows?.lit ?? 0.5, 0, 1);
    walls.forEach((wallOn, index) => {
      const [from, to] = [wallOn.in0 + 0.35, wallOn.in1 - 0.35];
      if (to - from < 1.2) return;
      const bays = Math.max(1, Math.floor((to - from) / every));
      const bay = (to - from) / bays;
      const width = Math.min(bay * share, bay - 0.3);
      if (width < 0.4) return;
      for (let k = 0; k < levels.length; k += 1) {
        const y0 = levels[k]! + sill * floorHeight;
        const y1 = Math.min(y0 + tall * floorHeight, levels[k]! + floorHeight - BUILDING.slab - 0.2);
        if (y1 - y0 < 0.4) continue;
        for (let b = 0; b < bays; b += 1) {
          const m0 = from + bay * b + (bay - width) / 2;
          const glows = next() < lit;
          // No window where the door is.
          if (k === 0 && door && door.side === index && m0 < door.m1 + 0.3 && m0 + width > door.m0 - 0.3) continue;
          wallOn.openings.push({ m0, m1: m0 + width, y0, y1, door: false, lit: glows });
        }
      }
    });
  }

  // Stairs, where she put them or where there is most room, and of the kind that fits all the way up.
  let stairs: Stairs | null = null;
  if (floors > 1 && spec.stairs !== false) {
    const shrink = 1 - (1 - taper) * (levels[floors - 1]! / wallTop);
    const least = inner.map(([x, z]) => [x * shrink, z * shrink] as P2);
    const risers = Math.ceil(floorHeight / BUILDING.riser);
    const run = (Math.ceil(risers / 2) - 1) * BUILDING.tread + BUILDING.flight;
    const back = Math.min(...least.map((p) => p[1]));
    const kinds: Stairs[] = [
      { kind: "flights", x: 0, z: 0, hw: BUILDING.flight + 0.1, hd: run / 2 },
      { kind: "spiral", x: 0, z: 0, hw: 1.4, hd: 1.4 },
      { kind: "spiral", x: 0, z: 0, hw: 1.1, hd: 1.1 },
      { kind: "ladder", x: 0, z: 0, hw: 0.45, hd: 0.45 },
    ];
    for (const kind of kinds) {
      // Left to the tool, a block's stairs stand against its back wall, and any other shape's in its middle.
      const spots: P2[] = spec.stairs?.at ? [spec.stairs.at] : (spec.outline.shape ?? "block") === "block" ? [[0, back + 0.3 + kind.hd], [0, 0]] : [[0, 0]];
      const fit = spots.find(([x, z]) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].every(([sx, sz]) => within(least, x + sx! * kind.hw, z + sz! * kind.hd, 0.15)) && within(least, x, z + kind.hd + 0.9, 0.1));
      if (!fit) continue;
      stairs = { ...kind, x: fit[0], z: fit[1] };
      break;
    }
  }
  return { outer, inner, walls, floorHeight, wall, levels, top, wallTop, taper, door, stairs };
}

/** The building as a mesh. `material` is what its walls are made of. */
export function buildingMesh(spec: BuildingSpec, material: number, next: () => number): Mesh {
  const mesh = emptyMesh();
  const plan = layoutOf(spec, next);
  const { walls, wall, levels, top, wallTop, floorHeight } = plan;
  const size = (y: number) => 1 - (1 - plan.taper) * clamp(y / wallTop, 0, 1);
  const quad = (p: Vec3, q: Vec3, r: Vec3, s: Vec3, made: number) => {
    const [a, b, c, d] = [vertex(mesh, p), vertex(mesh, q), vertex(mesh, r), vertex(mesh, s)];
    triangle(mesh, a, b, c, made);
    triangle(mesh, a, c, d, made);
  };
  /** A point on a wall: `m` metres along it, `y` up, and `inward` metres in from its outside face. */
  const on = (w: Wall, m: number, y: number, inward = 0): Vec3 => {
    const s = size(y);
    return [(w.a[0] + w.e[0] * m - w.n[0] * inward) * s, y, (w.a[1] + w.e[1] * m - w.n[1] * inward) * s];
  };
  const panel = (w: Wall, m0: number, m1: number, y0: number, y1: number, inward: number, made: number) => quad(on(w, m0, y0, inward), on(w, m1, y0, inward), on(w, m1, y1, inward), on(w, m0, y1, inward), made);
  /** A flat piece that runs through the wall: the side, top or bottom of an opening, or a ledge. */
  const shelf = (w: Wall, m0: number, m1: number, y: number, from: number, to: number, made: number) => quad(on(w, m0, y, from), on(w, m1, y, from), on(w, m1, y, to), on(w, m0, y, to), made);
  const cheek = (w: Wall, m: number, y0: number, y1: number, from: number, to: number, made: number) => quad(on(w, m, y0, from), on(w, m, y0, to), on(w, m, y1, to), on(w, m, y1, from), made);
  const [stone, metal, glass, body, glow, dark] = [id("stone"), id("metal"), id("glass"), id("body"), id("glow"), id("dark")];
  const trim = material === stone ? metal : stone;

  for (const w of walls) {
    // Both faces of the wall, laid in level bands so that every opening is a clean hole through it.
    const cuts = [...new Set([0, wallTop, ...w.openings.flatMap((o) => [o.y0, o.y1])])].sort((p, q) => p - q);
    for (const [inward, from, to] of [[0, 0, w.long], [wall, w.in0, w.in1]] as const) {
      for (let band = 0; band + 1 < cuts.length; band += 1) {
        const [y0, y1] = [cuts[band]!, cuts[band + 1]!];
        let at = from;
        for (const o of w.openings.filter((o) => o.y0 <= y0 + 1e-6 && o.y1 >= y1 - 1e-6).sort((p, q) => p.m0 - q.m0)) {
          if (o.m0 > at) panel(w, at, o.m0, y0, y1, inward, material);
          at = o.m1;
        }
        if (to > at) panel(w, at, to, y0, y1, inward, material);
      }
    }
    for (const o of w.openings) {
      // The thickness of the wall, seen in the opening.
      cheek(w, o.m0, o.y0, o.y1, 0, wall, material);
      cheek(w, o.m1, o.y0, o.y1, 0, wall, material);
      shelf(w, o.m0, o.m1, o.y1, 0, wall, material);
      const deep = wall / 2;
      const bar = 0.07;
      // A frame set a little in front of where the glass or the door hangs.
      panel(w, o.m0, o.m0 + bar, o.y0, o.y1, deep - 0.03, metal);
      panel(w, o.m1 - bar, o.m1, o.y0, o.y1, deep - 0.03, metal);
      panel(w, o.m0 + bar, o.m1 - bar, o.y1 - bar, o.y1, deep - 0.03, metal);
      if (o.door) {
        // Leaves that stand open into the building, a canopy with her light under it, and a step up to the sill.
        const leaves = o.m1 - o.m0 >= 1.8 ? 2 : 1;
        const leaf = (o.m1 - o.m0 - 2 * bar) / leaves;
        const swing = (hinge: number, way: number) => {
          const [c, s] = [Math.cos(1.4) * leaf * way, Math.sin(1.4) * leaf];
          quad(on(w, hinge, o.y0 + 0.02, wall), on(w, hinge + c, o.y0 + 0.02, wall + s), on(w, hinge + c, o.y1 - bar, wall + s), on(w, hinge, o.y1 - bar, wall), body);
          // A handle, at the height of a hand.
          quad(on(w, hinge + c * 0.86, o.y0 + 1, wall + s * 0.86 + 0.02 * way), on(w, hinge + c * 0.94, o.y0 + 1, wall + s * 0.94 + 0.02 * way), on(w, hinge + c * 0.94, o.y0 + 1.12, wall + s * 0.94 + 0.02 * way), on(w, hinge + c * 0.86, o.y0 + 1.12, wall + s * 0.86 + 0.02 * way), glow);
        };
        swing(o.m0 + bar, 1);
        if (leaves === 2) swing(o.m1 - bar, -1);
        const [from, to, under, over] = [o.m0 - 0.4, o.m1 + 0.4, o.y1 + 0.25, o.y1 + 0.37];
        shelf(w, from, to, over, -1.1, 0, metal);
        shelf(w, from, to, under, -1.1, 0, metal);
        panel(w, from, to, under, over, -1.1, metal);
        cheek(w, from, under, over, -1.1, 0, metal);
        cheek(w, to, under, over, -1.1, 0, metal);
        shelf(w, from + 0.1, to - 0.1, under - 0.01, -1.05, -0.9, glow);
        shelf(w, o.m0 - 0.3, o.m1 + 0.3, o.y0, -0.9, 0, trim);
        panel(w, o.m0 - 0.3, o.m1 + 0.3, 0, o.y0, -0.9, trim);
        cheek(w, o.m0 - 0.3, 0, o.y0, -0.9, 0, trim);
        cheek(w, o.m1 + 0.3, 0, o.y0, -0.9, 0, trim);
        continue;
      }
      shelf(w, o.m0, o.m1, o.y0, 0, wall, material);
      panel(w, o.m0 + bar, o.m1 - bar, o.y0, o.y0 + bar, deep - 0.03, metal);
      panel(w, o.m0, o.m1, o.y0, o.y1, deep, o.lit ? glow : glass);
      // A wide window is split by an upright, and a tall one by a rail.
      if (o.m1 - o.m0 > 1.8) panel(w, (o.m0 + o.m1) / 2 - 0.03, (o.m0 + o.m1) / 2 + 0.03, o.y0 + bar, o.y1 - bar, deep - 0.03, metal);
      if (o.y1 - o.y0 > 2.2) panel(w, o.m0 + bar, o.m1 - bar, o.y0 + (o.y1 - o.y0) * 0.62, o.y0 + (o.y1 - o.y0) * 0.62 + 0.06, deep - 0.03, metal);
      // A sill that stands out from the wall and sheds the rain.
      const [left, right, low] = [o.m0 - 0.06, o.m1 + 0.06, o.y0 - 0.07];
      shelf(w, left, right, o.y0, -0.12, 0, trim);
      panel(w, left, right, low, o.y0, -0.12, trim);
      cheek(w, left, low, o.y0, -0.12, 0, trim);
      cheek(w, right, low, o.y0, -0.12, 0, trim);
    }
    // A plinth at the foot of the wall, broken where the door is, and kept below the lowest window.
    const foot = Math.min(0.45, ...w.openings.filter((o) => !o.door).map((o) => o.y0 - 0.1));
    const gaps = w.openings.filter((o) => o.door).map((o) => [o.m0 - 0.3, o.m1 + 0.3] as const);
    let done = 0;
    for (const [from, to] of [...gaps, [w.long, w.long] as const]) {
      if (from > done && foot > 0.15) {
        panel(w, done, from, 0, foot, -0.05, trim);
        shelf(w, done, from, foot, -0.05, 0, trim);
      }
      done = to;
    }
    // A coping on top of the wall, and a line of her light just under it.
    shelf(w, 0, w.long, wallTop, 0, wall, trim);
    panel(w, 0, w.long, wallTop - 0.16, wallTop - 0.06, -0.02, glow);
  }

  // Floors. Each is a slab with a top to stand on and an underside that is the ceiling below. Above the ground floor the stairwell is cut out.
  const well = plan.stairs;
  const hole: P2[] | null = well ? [[well.x - well.hw, well.z + well.hd], [well.x + well.hw, well.z + well.hd], [well.x + well.hw, well.z - well.hd], [well.x - well.hw, well.z - well.hd]] : null;
  const deck = (y: number, cut: boolean, made: number) => {
    const rim = plan.inner.map(([x, z]) => [x * size(y), z * size(y)] as P2);
    const flat = (p: P2, q: P2, r: P2) => triangle(mesh, vertex(mesh, [p[0], y, p[1]]), vertex(mesh, [q[0], y, q[1]]), vertex(mesh, [r[0], y, r[1]]), made);
    if (!cut || !hole) {
      for (let i = 1; i + 1 < rim.length; i += 1) flat(rim[0]!, rim[i]!, rim[i + 1]!);
      return;
    }
    // The ring between the walls and the stairwell: walk round both at once, by angle from the middle of the well.
    const turned = (shape: P2[]) => {
      const angle = (p: P2) => Math.atan2(p[1] - well!.z, p[0] - well!.x);
      const first = shape.reduce((best, p, i) => (angle(p) < angle(shape[best]!) ? i : best), 0);
      // Which way round the shape is listed, so it is walked the way the angle grows.
      const going = shape.reduce((sum, p, i) => sum + p[0] * shape[(i + 1) % shape.length]![1] - shape[(i + 1) % shape.length]![0] * p[1], 0) > 0 ? 1 : -1;
      const points = shape.map((_, i) => shape[(first + going * i + shape.length * 2) % shape.length]!);
      return { points: [...points, points[0]!], angles: [...points.map(angle), angle(points[0]!) + Math.PI * 2] };
    };
    const [out, into] = [turned(rim), turned(hole)];
    let [i, j] = [0, 0];
    while (i < rim.length || j < hole.length) {
      if (j >= hole.length || (i < rim.length && out.angles[i + 1]! <= into.angles[j + 1]!)) {
        flat(out.points[i]!, out.points[i + 1]!, into.points[j]!);
        i += 1;
      } else {
        flat(out.points[i]!, into.points[j + 1]!, into.points[j]!);
        j += 1;
      }
    }
  };
  for (let k = 0; k <= levels.length; k += 1) {
    const y = k < levels.length ? levels[k]! : top;
    const cut = k > 0 && k < levels.length;
    deck(y, cut, dark);
    if (k > 0) deck(y - BUILDING.slab, cut, stone);
    if (cut && hole) {
      // The edge of the floor round the stairwell, and a rail on the three sides nobody steps through.
      hole.forEach((p, i) => {
        const q = hole[(i + 1) % 4]!;
        quad([p[0], y - BUILDING.slab, p[1]], [q[0], y - BUILDING.slab, q[1]], [q[0], y, q[1]], [p[0], y, p[1]], stone);
        if (i === 0) return;
        quad([p[0], y, p[1]], [q[0], y, q[1]], [q[0], y + 1, q[1]], [p[0], y + 1, p[1]], glass);
        quad([p[0], y + 1, p[1]], [q[0], y + 1, q[1]], [q[0], y + 1.05, q[1]], [p[0], y + 1.05, p[1]], metal);
      });
    }
  }

  // Stairs from each floor to the next.
  if (well) {
    const risers = Math.ceil(floorHeight / BUILDING.riser);
    const rise = floorHeight / risers;
    const box = (x0: number, x1: number, z0: number, z1: number, y: number, made: number) => quad([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], made);
    const face = (x0: number, x1: number, z: number, y0: number, y1: number, made: number) => quad([x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z], made);
    for (let k = 0; k + 1 < levels.length; k += 1) {
      const y = levels[k]!;
      if (well.kind === "flights") {
        // Up the left to a landing at the back, then up the right and out at the front, facing the way she came in.
        const first = Math.ceil(risers / 2);
        const [front, back, landing] = [well.z + well.hd, well.z - well.hd, well.z - well.hd + BUILDING.flight];
        const [left, mid, right] = [well.x - well.hw, well.x, well.x + well.hw];
        for (let j = 1; j < first; j += 1) {
          face(left, mid - 0.1, front - (j - 1) * BUILDING.tread, y + (j - 1) * rise, y + j * rise, metal);
          box(left, mid - 0.1, front - j * BUILDING.tread, front - (j - 1) * BUILDING.tread, y + j * rise, metal);
        }
        face(left, mid - 0.1, landing, y + (first - 1) * rise, y + first * rise, metal);
        box(left, right, back, landing, y + first * rise, metal);
        const rest = risers - first;
        for (let j = 1; j < rest; j += 1) {
          face(mid + 0.1, right, landing + (j - 1) * BUILDING.tread, y + (first + j - 1) * rise, y + (first + j) * rise, metal);
          box(mid + 0.1, right, landing + (j - 1) * BUILDING.tread, landing + j * BUILDING.tread, y + (first + j) * rise, metal);
        }
        const last = landing + (rest - 1) * BUILDING.tread;
        face(mid + 0.1, right, last, y + (risers - 1) * rise, y + floorHeight, metal);
        // The last stretch is level with the floor above, as far as the front of the well.
        if (front > last) box(mid + 0.1, right, last, front, y + floorHeight, dark);
        // A rail between the two flights.
        quad([mid, y + 0.9, front], [mid, y + first * rise + 0.9, landing], [mid, y + first * rise + 1, landing], [mid, y + 1, front], metal);
        quad([mid, y + first * rise + 0.9, landing], [mid, y + floorHeight + 0.9, front], [mid, y + floorHeight + 1, front], [mid, y + first * rise + 1, landing], metal);
      } else if (well.kind === "spiral") {
        // Once round a post for each floor, starting and ending at the front.
        const reach = well.hw - 0.1;
        const spot = (angle: number, far: number, up: number): Vec3 => [well.x + Math.cos(angle) * far, up, well.z + Math.sin(angle) * far];
        for (let j = 1; j <= risers; j += 1) {
          const [from, to] = [Math.PI / 2 - ((j - 1) / risers) * Math.PI * 2, Math.PI / 2 - (j / risers) * Math.PI * 2];
          quad(spot(from, 0.1, y + (j - 1) * rise), spot(from, reach, y + (j - 1) * rise), spot(from, reach, y + j * rise), spot(from, 0.1, y + j * rise), metal);
          quad(spot(from, 0.1, y + j * rise), spot(from, reach, y + j * rise), spot(to, reach, y + j * rise), spot(to, 0.1, y + j * rise), j === risers ? dark : metal);
        }
        for (let side = 0; side < 3; side += 1) {
          const angle = (side * Math.PI) / 3;
          quad(spot(angle, 0.1, y), spot(angle + Math.PI, 0.1, y), spot(angle + Math.PI, 0.1, y + floorHeight + 1), spot(angle, 0.1, y + floorHeight + 1), metal);
        }
      } else {
        // A ladder up the back of a small well.
        const back = well.z - well.hd + 0.06;
        for (const x of [well.x - 0.25, well.x + 0.25]) face(x - 0.02, x + 0.02, back, y, y + floorHeight + 1, metal);
        for (let up = 0.3; up < floorHeight; up += 0.3) face(well.x - 0.25, well.x + 0.25, back, y + up - 0.02, y + up + 0.02, metal);
      }
    }
  }
  return mesh;
}

/** One building as the live world needs it to let someone walk inside: every floor's outline, the door and the stairs, in the build's own metres. */
export type BuildingPlan = {
  floorHeight: number;
  /** Each floor's height and the room inside its walls, ground floor first. */
  floors: { y: number; room: [number, number][] }[];
  /** The middle of the doorway, the way out of it, and its size. */
  door: { at: Vec3; out: [number, number]; width: number; height: number } | null;
  /** The stairwell, with the spot in front of it where she steps on and off. */
  stairs: { kind: Stairs["kind"]; well: [number, number][]; foot: [number, number] } | null;
};

export function buildingPlan(spec: BuildingSpec, where: { at?: Vec3; turn?: number }): BuildingPlan {
  const plan = layoutOf(spec);
  const size = (y: number) => 1 - (1 - plan.taper) * clamp(y / plan.wallTop, 0, 1);
  const put = (x: number, y: number, z: number): Vec3 => place([x, y, z], { at: where.at, turn: where.turn });
  const flat = (x: number, z: number): [number, number] => {
    const p = put(x, 0, z);
    return [p[0], p[2]];
  };
  const way = (x: number, z: number): [number, number] => {
    const p = place([x, 0, z], { turn: where.turn });
    return [p[0], p[2]];
  };
  const floors = plan.levels.map((y) => ({ y: put(0, y, 0)[1], room: plan.inner.map(([x, z]) => flat(x * size(y), z * size(y))) }));
  let door: BuildingPlan["door"] = null;
  if (plan.door) {
    const w = plan.walls[plan.door.side]!;
    const [m, y] = [(plan.door.m0 + plan.door.m1) / 2, plan.levels[0]!];
    door = { at: put((w.a[0] + w.e[0] * m - w.n[0] * plan.wall * 0.5) * size(y), y, (w.a[1] + w.e[1] * m - w.n[1] * plan.wall * 0.5) * size(y)), out: way(w.n[0], w.n[1]), width: plan.door.m1 - plan.door.m0, height: plan.door.height };
  }
  const s = plan.stairs;
  const stairs = s ? { kind: s.kind, well: ([[-1, 1], [1, 1], [1, -1], [-1, -1]] as const).map(([sx, sz]) => flat(s.x + sx * s.hw, s.z + sz * s.hd)), foot: flat(s.x, s.z + s.hd + 0.7) } : null;
  return { floorHeight: plan.floorHeight, floors, door, stairs };
}
