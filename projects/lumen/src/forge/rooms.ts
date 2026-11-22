import { away, keepOff, WALK } from "../world/walk";
import type { MaterialName } from "./mesh";

/**
 * Her rooms.
 *
 * Inside a building she draws walls, and puts doors in them. Where her walls close a space off, that
 * space is a room. She says which rooms are homes and which are shops by marking a spot inside each.
 * A room she does not mark is a hall: a lobby, a corridor, a landing.
 *
 * This file works out one floor. It joins her walls where they meet, finds every room they close,
 * measures each one, and cuts her doors. It decides nothing for her: no wall, door or room is here
 * unless she drew it.
 *
 * Three things are held to, and they are the ones agreed with the owner:
 * - A home or a shop is at least 6.5 square metres, with room for a circle 2.13 metres across. A hall
 *   has room for a circle 1.12 metres across. Those are the figures a building code gives for the
 *   smallest liveable room and the narrowest corridor.
 * - Every room can be walked to from the way in: the front door on the ground floor, the stairs above.
 *   This is tested by walking, with the same test the live world uses to move someone about, so a room
 *   the forge allows is one that can really be reached.
 * - Nothing she draws may stand in the front doorway or on the stairs.
 */

type P2 = [number, number];

export const ROOMS = {
  /** How thick an inside wall is: a stud wall with board on both faces. */
  wall: 0.115,
  /** A wall that stops this close to another wall, or runs this far past it, is joined to it. */
  join: 0.25,
  /** The least, most and usual width of a door in an inside wall, and how tall one is. */
  door: [0.82, 2.4, 0.95],
  doorHeight: 2.05,
  /** The least floor space of a home or a shop in square metres, the widest circle that must fit in one, and the widest that must fit in a hall. */
  area: 6.5,
  across: 2.13,
  hall: 1.12,
  /** The most layouts in one building, walls in a layout, doors in a wall and marked rooms in a layout. */
  layouts: 12,
  walls: 48,
  doors: 4,
  marks: 64,
  /** The most triangles the inside of one building may be drawn with. */
  triangles: 60_000,
  /** How fine the grid is that reaching a room is tested on, in metres. A doorway is always wider than two of its squares. */
  grid: 0.1,
} as const;

export type InsideWall = { from: P2; to: P2; doors?: { at: number; width?: number }[] };
export type RoomMark = { at: P2; use: "home" | "shop" | "hall"; name?: string };
/** One layout: the floors it is on, counted from 1 at the ground, what its walls are made of, the walls, and the rooms she marks. */
export type InsideSpec = { floors: [number, number]; material?: MaterialName; walls: InsideWall[]; rooms?: RoomMark[] };

/** A solid stretch of inside wall. `open` says whether each end is a bare end, a door's edge or a free end, rather than a join with another wall. */
export type Span = { a: P2; b: P2; open: [boolean, boolean] };
/** A doorway: its two edges, the rooms on its left and right going from a to b (-1 is the stairs or nothing), and how much plain wall there is before a and after b. */
export type Doorway = { a: P2; b: P2; rooms: [number, number]; beside: [number, number] };
export type Room = { outline: P2[]; holes: P2[][]; area: number; /** The widest circle that fits, and where its middle is. */ across: number; at: P2; use: "home" | "shop" | "hall"; name: string | null; /** Which of her marks made it a home, a shop or a named hall. */ mark: number | null };
export type FloorInside = { spans: Span[]; doors: Doorway[]; rooms: Room[]; /** What is wrong with it, if anything, as codes the forge refuses a design with. */ problems: string[] };

const cross = (ax: number, az: number, bx: number, bz: number) => ax * bz - az * bx;
const shoelace = (ring: P2[]) => ring.reduce((sum, p, i) => sum + cross(p[0], p[1], ring[(i + 1) % ring.length]![0], ring[(i + 1) % ring.length]![1]), 0) / 2;

/** Each side of a shape with no dents, as a point on it and the way in from it. */
function sides(shape: P2[]): { a: P2; n: P2 }[] {
  const turn = shoelace(shape) >= 0 ? 1 : -1;
  return shape.map((a, i) => {
    const b = shape[(i + 1) % shape.length]!;
    const far = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return { a, n: [(-(b[1] - a[1]) / far) * turn, ((b[0] - a[0]) / far) * turn] as P2 };
  });
}

/** The part of a line from `o` along `u` that lies inside a shape with no dents, as distances along it. */
function clip(shape: P2[], o: P2, u: P2, from: number, to: number): [number, number] | null {
  let [s0, s1] = [from, to];
  for (const { a, n } of sides(shape)) {
    const at = (o[0] - a[0]) * n[0] + (o[1] - a[1]) * n[1];
    const rate = u[0] * n[0] + u[1] * n[1];
    if (Math.abs(rate) < 1e-12) {
      if (at < -1e-9) return null;
      continue;
    }
    if (rate > 0) s0 = Math.max(s0, -at / rate);
    else s1 = Math.min(s1, -at / rate);
  }
  return s1 - s0 > 1e-9 ? [s0, s1] : null;
}

/** Whether a point is inside a ring, counted the even-odd way, so a wall that runs out into a room and back does not matter. */
function holds(ring: P2[], x: number, z: number): boolean {
  let within = false;
  for (let i = 0; i < ring.length; i += 1) {
    const [a, b] = [ring[i]!, ring[(i + 1) % ring.length]!];
    if (a[1] > z !== b[1] > z && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) within = !within;
  }
  return within;
}

/** The widest circle that fits in a room: its middle and its radius. `rings` is the room's edge, then the edge of anything standing free inside it. */
function widest(rings: P2[][]): { at: P2; radius: number } {
  const edge = rings[0]!;
  // Every side of every ring as four numbers. This is asked thousands of times for one room, so it makes nothing new as it goes.
  const flat = Float64Array.from(rings.flatMap((ring) => ring.flatMap((a, i) => [a[0], a[1], ring[(i + 1) % ring.length]![0], ring[(i + 1) % ring.length]![1]])));
  /** How far inside the room a spot is: the distance to its nearest wall, or less than nothing outside it. */
  const reach = (x: number, z: number): number => {
    let within = false;
    let least = Infinity;
    for (let k = 0; k < flat.length; k += 4) {
      const ax = flat[k]!;
      const az = flat[k + 1]!;
      const dx = flat[k + 2]! - ax;
      const dz = flat[k + 3]! - az;
      if (az > z !== az + dz > z && x < (dx * (z - az)) / dz + ax) within = !within;
      const long = dx * dx + dz * dz;
      const t = long < 1e-18 ? 0 : Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / long));
      const far = (x - ax - dx * t) * (x - ax - dx * t) + (z - az - dz * t) * (z - az - dz * t);
      if (far < least) least = far;
    }
    return within ? Math.sqrt(least) : -Math.sqrt(least);
  };
  const [minX, maxX] = [Math.min(...edge.map((p) => p[0])), Math.max(...edge.map((p) => p[0]))];
  const [minZ, maxZ] = [Math.min(...edge.map((p) => p[1])), Math.max(...edge.map((p) => p[1]))];
  const size = Math.min(maxX - minX, maxZ - minZ);
  if (!(size > 1e-6)) return { at: [minX, minZ], radius: 0 };
  // Squares that might hold the middle, the most promising first. A square is split in four until none could beat the best by more than half a centimetre.
  type Cell = { x: number; z: number; half: number; far: number; most: number };
  const cell = (x: number, z: number, half: number): Cell => {
    const far = reach(x, z);
    return { x, z, half, far, most: far + half * Math.SQRT2 };
  };
  let best = cell((minX + maxX) / 2, (minZ + maxZ) / 2, 0);
  const heap: Cell[] = [];
  const push = (item: Cell) => {
    let at = heap.push(item) - 1;
    while (at > 0) {
      const up = (at - 1) >> 1;
      if (heap[up]!.most >= heap[at]!.most) break;
      [heap[up], heap[at]] = [heap[at]!, heap[up]!];
      at = up;
    }
  };
  const pop = (): Cell => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let at = 0; ; ) {
        const [left, right] = [at * 2 + 1, at * 2 + 2];
        let most = at;
        if (left < heap.length && heap[left]!.most > heap[most]!.most) most = left;
        if (right < heap.length && heap[right]!.most > heap[most]!.most) most = right;
        if (most === at) break;
        [heap[most], heap[at]] = [heap[at]!, heap[most]!];
        at = most;
      }
    }
    return top;
  };
  for (let x = minX; x < maxX; x += size) for (let z = minZ; z < maxZ; z += size) push(cell(x + size / 2, z + size / 2, size / 2));
  while (heap.length) {
    const next = pop();
    if (next.far > best.far) best = next;
    // The most promising square left cannot beat the best, so none can.
    if (next.most - best.far <= 0.005) break;
    const half = next.half / 2;
    push(cell(next.x - half, next.z - half, half));
    push(cell(next.x + half, next.z - half, half));
    push(cell(next.x - half, next.z + half, half));
    push(cell(next.x + half, next.z + half, half));
  }
  return { at: [best.x, best.z], radius: Math.max(0, best.far) };
}

/** A ring with every point on a straight run taken out, and with it every wall that runs out into the room and back, for drawing. */
function tidy(ring: P2[]): P2[] {
  const out = [...ring];
  for (let changed = true; changed && out.length > 3; ) {
    changed = false;
    for (let i = 0; i < out.length && out.length > 3; i += 1) {
      const [before, at, after] = [out[(i + out.length - 1) % out.length]!, out[i]!, out[(i + 1) % out.length]!];
      const flat = Math.abs(cross(at[0] - before[0], at[1] - before[1], after[0] - at[0], after[1] - at[1])) < 1e-9;
      if (!flat) continue;
      out.splice(i, 1);
      changed = true;
      i -= 1;
    }
  }
  return out;
}

/**
 * One floor, worked out from her walls. `rim` is the space inside the outside walls, and `well` is the
 * stairwell, if the building has stairs. Both have no dents. Nothing is refused here: what is wrong is
 * listed, so a floor that was once allowed can always be drawn.
 */
export function floorInside(rim: P2[], well: P2[] | null, spec: InsideSpec): FloorInside {
  const problems: string[] = [];
  // Her walls, each as a line from where she began it, cut to the inside of the outside walls.
  type Line = { wall: number; o: P2; u: P2; long: number; s0: number; s1: number };
  const lines: Line[] = [];
  spec.walls.forEach((wall, index) => {
    const long = Math.hypot(wall.to[0] - wall.from[0], wall.to[1] - wall.from[1]);
    if (long < 1e-6) return;
    const u: P2 = [(wall.to[0] - wall.from[0]) / long, (wall.to[1] - wall.from[1]) / long];
    const kept = clip(rim, wall.from, u, 0, long);
    if (kept && kept[1] - kept[0] >= 0.3) lines.push({ wall: index, o: wall.from, u, long, s0: kept[0], s1: kept[1] });
  });
  const along = (line: Line, s: number): P2 => [line.o[0] + line.u[0] * s, line.o[1] + line.u[1] * s];

  // An end that stops just short of a wall is carried on to it, so a room she meant to close is closed.
  type Target = { a: P2; b: P2; pad: number; wall: number };
  const ring = (shape: P2[]): Target[] => shape.map((a, i) => ({ a, b: shape[(i + 1) % shape.length]!, pad: 0, wall: -1 }));
  const targets: Target[] = [...ring(rim), ...(well ? ring(well) : []), ...lines.map((line) => ({ a: along(line, line.s0), b: along(line, line.s1), pad: ROOMS.join, wall: line.wall }))];
  const meet = (o: P2, u: P2, target: Target): number | null => {
    const [dx, dz] = [target.b[0] - target.a[0], target.b[1] - target.a[1]];
    const long = Math.hypot(dx, dz);
    const den = cross(u[0], u[1], dx, dz);
    if (long < 1e-9 || Math.abs(den) < 1e-9 * long) return null;
    const [wx, wz] = [target.a[0] - o[0], target.a[1] - o[1]];
    const on = (cross(wx, wz, u[0], u[1]) / den) * long;
    return on < -target.pad - 1e-9 || on > long + target.pad + 1e-9 ? null : cross(wx, wz, dx, dz) / den;
  };
  const carried = lines.map((line) => {
    const grow = (from: P2, way: P2): number => {
      let least = Infinity;
      for (const target of targets) {
        if (target.wall === line.wall) continue;
        const s = meet(from, way, target);
        if (s !== null && s >= -1e-9 && s <= ROOMS.join && s < least) least = s;
      }
      return Number.isFinite(least) ? Math.max(0, least) : 0;
    };
    return { ...line, s0: line.s0 - grow(along(line, line.s0), [-line.u[0], -line.u[1]]), s1: line.s1 + grow(along(line, line.s1), line.u) };
  });
  // Nothing she draws may stand on the stairs.
  if (well && carried.some((line) => {
    const on = clip(well, line.o, line.u, line.s0, line.s1);
    if (!on || on[1] - on[0] <= 0.05) return false;
    // A wall that only runs along the edge of the stairwell is not on the stairs.
    const [x, z] = along(line, (on[0] + on[1]) / 2);
    return sides(well).every(({ a, n }) => (x - a[0]) * n[0] + (z - a[1]) * n[1] > 0.01);
  })) problems.push("FORGE_ROOM_WAY");

  // Every stretch of wall, cut wherever two of them meet, so that they touch only at their ends.
  type Seg = { a: P2; b: P2; kind: 0 | 1 | 2; line: Line | null };
  const segs: Seg[] = [
    ...rim.map((a, i) => ({ a, b: rim[(i + 1) % rim.length]!, kind: 0 as const, line: null })),
    ...(well ? well.map((a, i) => ({ a, b: well[(i + 1) % well.length]!, kind: 1 as const, line: null })) : []),
    ...carried.map((line) => ({ a: along(line, line.s0), b: along(line, line.s1), kind: 2 as const, line })),
  ];
  const cuts: number[][] = segs.map(() => [0, 1]);
  for (let i = 0; i < segs.length; i += 1) {
    for (let j = i + 1; j < segs.length; j += 1) {
      const [A, B] = [segs[i]!, segs[j]!];
      const [rx, rz, qx, qz] = [A.b[0] - A.a[0], A.b[1] - A.a[1], B.b[0] - B.a[0], B.b[1] - B.a[1]];
      const [wx, wz] = [B.a[0] - A.a[0], B.a[1] - A.a[1]];
      const [lr, lq] = [Math.hypot(rx, rz), Math.hypot(qx, qz)];
      if (lr < 1e-9 || lq < 1e-9) continue;
      const den = cross(rx, rz, qx, qz);
      const [et, ev] = [1e-6 / lr, 1e-6 / lq];
      if (Math.abs(den) > 1e-9 * lr * lq) {
        const [t, v] = [cross(wx, wz, qx, qz) / den, cross(wx, wz, rx, rz) / den];
        if (t < -et || t > 1 + et || v < -ev || v > 1 + ev) continue;
        cuts[i]!.push(Math.min(1, Math.max(0, t)));
        cuts[j]!.push(Math.min(1, Math.max(0, v)));
      } else if (Math.abs(cross(wx, wz, rx, rz)) / lr < 1e-6) {
        // Two stretches on one line: each is cut where the other's ends fall on it.
        for (const p of [B.a, B.b]) {
          const t = ((p[0] - A.a[0]) * rx + (p[1] - A.a[1]) * rz) / (lr * lr);
          if (t > et && t < 1 - et) cuts[i]!.push(t);
        }
        for (const p of [A.a, A.b]) {
          const v = ((p[0] - B.a[0]) * qx + (p[1] - B.a[1]) * qz) / (lq * lq);
          if (v > ev && v < 1 - ev) cuts[j]!.push(v);
        }
      }
    }
  }
  const points: P2[] = [];
  const pointAt = (p: P2): number => {
    for (let i = 0; i < points.length; i += 1) if (Math.abs(points[i]![0] - p[0]) < 1e-4 && Math.abs(points[i]![1] - p[1]) < 1e-4) return i;
    points.push(p);
    return points.length - 1;
  };
  /** One piece of wall between two points. For her own walls, `s` is how far along the wall as she wrote it each end is. */
  type Edge = { u: number; v: number; kind: 0 | 1 | 2; line: Line | null; su: number; sv: number; gone: boolean };
  const edges: Edge[] = [];
  const have = new Set<string>();
  segs.forEach((seg, index) => {
    const order = [...new Set(cuts[index]!)].sort((p, q) => p - q);
    for (let k = 0; k + 1 < order.length; k += 1) {
      const [t0, t1] = [order[k]!, order[k + 1]!];
      const [u, v] = [pointAt([seg.a[0] + (seg.b[0] - seg.a[0]) * t0, seg.a[1] + (seg.b[1] - seg.a[1]) * t0]), pointAt([seg.a[0] + (seg.b[0] - seg.a[0]) * t1, seg.a[1] + (seg.b[1] - seg.a[1]) * t1])];
      const key = u < v ? `${u}:${v}` : `${v}:${u}`;
      // A wall drawn along an outside wall, or twice in one place, is one wall.
      if (u === v || have.has(key)) continue;
      have.add(key);
      const span = seg.line ? seg.line.s1 - seg.line.s0 : 0;
      edges.push({ u, v, kind: seg.kind, line: seg.line, su: seg.line ? seg.line.s0 + span * t0 : 0, sv: seg.line ? seg.line.s0 + span * t1 : 0, gone: false });
    }
  });
  // A short end left sticking out past a join is taken off.
  const degree = points.map(() => 0);
  for (const edge of edges) {
    degree[edge.u] = degree[edge.u]! + 1;
    degree[edge.v] = degree[edge.v]! + 1;
  }
  for (let changed = true; changed; ) {
    changed = false;
    for (const edge of edges) {
      if (edge.gone || edge.kind !== 2 || (degree[edge.u] !== 1 && degree[edge.v] !== 1) || Math.abs(edge.sv - edge.su) > ROOMS.join + 1e-6) continue;
      edge.gone = true;
      degree[edge.u] = degree[edge.u]! - 1;
      degree[edge.v] = degree[edge.v]! - 1;
      changed = true;
    }
  }
  const live = edges.filter((edge) => !edge.gone);

  // The rooms: walk round every closed space, keeping it on the left.
  const halves = live.flatMap((edge) => [{ from: edge.u, to: edge.v }, { from: edge.v, to: edge.u }]);
  const around: number[][] = points.map(() => []);
  halves.forEach((half, id) => around[half.from]!.push(id));
  const bearing = (id: number) => Math.atan2(points[halves[id]!.to]![1] - points[halves[id]!.from]![1], points[halves[id]!.to]![0] - points[halves[id]!.from]![0]);
  const place = new Array<number>(halves.length).fill(0);
  for (const list of around) {
    list.sort((p, q) => bearing(p) - bearing(q));
    list.forEach((id, index) => (place[id] = index));
  }
  const onward = (id: number): number => {
    const list = around[halves[id]!.to]!;
    return list[(place[id ^ 1]! - 1 + list.length) % list.length]!;
  };
  const group = points.map((_, i) => i);
  const root = (i: number): number => (group[i] === i ? i : (group[i] = root(group[i]!)));
  for (const edge of live) group[root(edge.u)] = root(edge.v);
  const rimPart = root(pointAt(rim[0]!));
  type Face = { loop: number[]; ring: P2[]; gross: number; area: number; holes: P2[][]; part: number };
  const faces: Face[] = [];
  const islands: { loop: number[]; ring: P2[]; size: number; part: number }[] = [];
  const faceOf = new Array<number>(halves.length).fill(-1);
  const seen = new Array<boolean>(halves.length).fill(false);
  for (let start = 0; start < halves.length; start += 1) {
    if (seen[start]) continue;
    const loop: number[] = [];
    for (let id = start; !seen[id]; id = onward(id)) {
      seen[id] = true;
      loop.push(id);
    }
    const ringOf = loop.map((id) => points[halves[id]!.from]!);
    const size = shoelace(ringOf);
    const part = root(halves[start]!.from);
    if (size > 1e-9) {
      for (const id of loop) faceOf[id] = faces.length;
      faces.push({ loop, ring: ringOf, gross: size, area: size, holes: [], part });
    } else if (part !== rimPart) islands.push({ loop, ring: ringOf, size: -size, part });
  }
  // Walls that stand free inside a room, and the stairwell if nothing touches it, belong to the room around them.
  for (const island of islands) {
    const [x, z] = island.ring[0]!;
    const home = faces.reduce((best, face, index) => (face.part !== island.part && holds(face.ring, x, z) && (best < 0 || face.gross < faces[best]!.gross) ? index : best), -1);
    if (home < 0) continue;
    faces[home]!.holes.push(island.ring);
    faces[home]!.area -= island.size;
    for (const id of island.loop) faceOf[id] = home;
  }
  const faceAt = (x: number, z: number): number => faces.reduce((best, face, index) => (holds(face.ring, x, z) && (best < 0 || face.gross < faces[best]!.gross) ? index : best), -1);
  const stairs = well ? faceAt(well.reduce((sum, p) => sum + p[0], 0) / well.length, well.reduce((sum, p) => sum + p[1], 0) / well.length) : -1;
  const roomOf = new Array<number>(faces.length).fill(-1);
  const rooms: Room[] = [];
  faces.forEach((face, index) => {
    if (index === stairs) return;
    const fit = widest([face.ring, ...face.holes]);
    roomOf[index] = rooms.length;
    rooms.push({ outline: tidy(face.ring), holes: face.holes.map(tidy), area: face.area, across: fit.radius * 2, at: fit.at, use: "hall", name: null, mark: null });
  });

  // Her doors, each cut from the piece of wall it stands in.
  const halfOf = new Map<Edge, number>();
  live.forEach((edge, index) => halfOf.set(edge, index * 2));
  const doors: Doorway[] = [];
  const gaps = new Map<Edge, [number, number][]>();
  for (const line of carried) {
    const pieces = live.filter((edge) => edge.kind === 2 && edge.line === line);
    for (const door of spec.walls[line.wall]!.doors ?? []) {
      const middle = Math.min(1, Math.max(0, door.at)) * line.long;
      const wide = Math.min(ROOMS.door[1], Math.max(ROOMS.door[0], door.width ?? ROOMS.door[2]));
      const piece = pieces.find((edge) => Math.min(edge.su, edge.sv) <= middle && middle <= Math.max(edge.su, edge.sv));
      // A door whose place on the wall is outside this floor is not on this floor.
      if (!piece) continue;
      const [low, high] = [Math.min(piece.su, piece.sv), Math.max(piece.su, piece.sv)];
      const cut = gaps.get(piece) ?? [];
      if (middle - wide / 2 < low + 0.1 || middle + wide / 2 > high - 0.1 || cut.some(([g0, g1]) => middle - wide / 2 < g1 + 0.2 && middle + wide / 2 > g0 - 0.2)) {
        problems.push("FORGE_ROOM_DOOR");
        continue;
      }
      gaps.set(piece, [...cut, [middle - wide / 2, middle + wide / 2]]);
      // Going the way she drew the wall, the room on the left and the room on the right.
      const forward = halfOf.get(piece)! + (piece.su <= piece.sv ? 0 : 1);
      const side = (id: number) => (faceOf[id]! < 0 ? -1 : roomOf[faceOf[id]!]!);
      doors.push({ a: along(line, middle - wide / 2), b: along(line, middle + wide / 2), rooms: [side(forward), side(forward ^ 1)], beside: [middle - wide / 2 - low, high - middle - wide / 2] });
    }
  }
  // What is left of each wall once its doors are cut: the solid stretches she walks round and that are drawn.
  const spans: Span[] = [];
  for (const line of carried) {
    const pieces = live.filter((edge) => edge.kind === 2 && edge.line === line).sort((p, q) => Math.min(p.su, p.sv) - Math.min(q.su, q.sv));
    let run: { from: number; to: number; free: [boolean, boolean] } | null = null;
    const close = () => {
      if (!run) return;
      const cut = pieces.flatMap((edge) => gaps.get(edge) ?? []).filter(([g0, g1]) => g0 >= run!.from - 1e-6 && g1 <= run!.to + 1e-6).sort((p, q) => p[0] - q[0]);
      let at = run.from;
      let open = run.free[0];
      for (const [g0, g1] of cut) {
        if (g0 - at > 1e-6) spans.push({ a: along(line, at), b: along(line, g0), open: [open, true] });
        at = g1;
        open = true;
      }
      if (run.to - at > 1e-6) spans.push({ a: along(line, at), b: along(line, run.to), open: [open, run.free[1]] });
      run = null;
    };
    for (const piece of pieces) {
      const [low, high] = [Math.min(piece.su, piece.sv), Math.max(piece.su, piece.sv)];
      const [first, last] = piece.su <= piece.sv ? [piece.u, piece.v] : [piece.v, piece.u];
      if (run && Math.abs(run.to - low) < 1e-6) {
        run.to = high;
        run.free[1] = degree[last] === 1;
        continue;
      }
      close();
      run = { from: low, to: high, free: [degree[first] === 1, degree[last] === 1] };
    }
    close();
  }

  // The rooms she marked.
  const rimSides = sides(rim);
  (spec.rooms ?? []).forEach((mark, index) => {
    // A mark outside this floor's walls is not for this floor.
    if (rimSides.some(({ a, n }) => (mark.at[0] - a[0]) * n[0] + (mark.at[1] - a[1]) * n[1] < 0)) return;
    const face = faceAt(mark.at[0], mark.at[1]);
    const room = face < 0 ? undefined : rooms[roomOf[face]!];
    if (!room || room.mark !== null) {
      problems.push("FORGE_ROOM_MARK");
      return;
    }
    room.mark = index;
    room.use = mark.use;
    room.name = mark.name ?? null;
  });
  for (const room of rooms) {
    const lived = room.use !== "hall";
    if ((lived && room.area < ROOMS.area - 1e-6) || room.across < (lived ? ROOMS.across : ROOMS.hall) - 0.012) problems.push("FORGE_ROOM_SMALL");
  }
  return { spans, doors, rooms, problems };
}

/**
 * Whether every room on a floor can be walked to from `entry`, with her walls where they are. `must`
 * are other spots that have to be reached too. Returns what is wrong, or null.
 *
 * The floor is tried on a fine grid. A spot counts if a body can stand there by the same test the
 * live world walks with. First the floor is walked with none of her walls, then with them: anywhere
 * that could be reached before and cannot be reached now has been shut off.
 *
 * On the grid a wall is counted a centimetre thicker than it is, and the stairwell five centimetres
 * wider. With that, a straight line between two squares next to each other never touches a wall or
 * the stairs, so whatever the grid can reach a body can walk to. The other way it errs toward
 * refusing: a body just fits through an opening 0.62 metres wide, and an opening under about 0.78 may
 * be counted as shut. A door is never narrower than 0.82.
 */
export function reach(rim: P2[], well: P2[] | null, floor: FloorInside, entry: P2, must: P2[] = []): string | null {
  const keep = keepOff(ROOMS.wall);
  // Each side as four numbers: a point on it and the way in from it.
  const flat = (shape: P2[]) => Float64Array.from(sides(shape).flatMap(({ a, n }) => [a[0], a[1], n[0], n[1]]));
  const rimSides = flat(rim);
  const wellSides = well ? flat(well) : new Float64Array(0);
  const body = WALK.body;
  const open = (x: number, z: number): boolean => {
    for (let k = 0; k < rimSides.length; k += 4) if ((x - rimSides[k]!) * rimSides[k + 2]! + (z - rimSides[k + 1]!) * rimSides[k + 3]! < body) return false;
    if (!wellSides.length) return true;
    // In the stairwell, or too near it, unless she is clear of one of its sides.
    for (let k = 0; k < wellSides.length; k += 4) if ((x - wellSides[k]!) * wellSides[k + 2]! + (z - wellSides[k + 1]!) * wellSides[k + 3]! < -body - 0.05) return true;
    return false;
  };
  const clear = (x: number, z: number): boolean => floor.spans.every((span) => away(x, z, span.a[0], span.a[1], span.b[0], span.b[1]) >= keep);
  // Nothing she draws may stand in the way in.
  for (const [x, z] of [entry, ...must]) if (open(x, z) && !clear(x, z)) return "FORGE_ROOM_WAY";
  const thick = keep + 0.009;

  const step = ROOMS.grid;
  const [minX, minZ] = [Math.min(...rim.map((p) => p[0])) + 0.0371, Math.min(...rim.map((p) => p[1])) + 0.0613];
  const [nx, nz] = [Math.max(1, Math.ceil((Math.max(...rim.map((p) => p[0])) - minX) / step)), Math.max(1, Math.ceil((Math.max(...rim.map((p) => p[1])) - minZ) / step))];
  const bare = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j += 1) {
    const z = minZ + j * step;
    for (let i = 0; i < nx; i += 1) if (open(minX + i * step, z)) bare[i + j * nx] = 1;
  }
  const walled = new Uint8Array(bare);
  for (const span of floor.spans) {
    const [ax, az, bx, bz] = [span.a[0], span.a[1], span.b[0], span.b[1]];
    const [dx, dz] = [bx - ax, bz - az];
    const long = dx * dx + dz * dz;
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - thick - minX) / step));
    const i1 = Math.min(nx - 1, Math.ceil((Math.max(ax, bx) + thick - minX) / step));
    const j0 = Math.max(0, Math.floor((Math.min(az, bz) - thick - minZ) / step));
    const j1 = Math.min(nz - 1, Math.ceil((Math.max(az, bz) + thick - minZ) / step));
    for (let j = j0; j <= j1; j += 1) {
      const z = minZ + j * step;
      for (let i = i0; i <= i1; i += 1) {
        // The same sum as `away`, written out because it is done for every square near every wall.
        const x = minX + i * step;
        const t = long < 1e-18 ? 0 : Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / long));
        if (Math.hypot(x - (ax + dx * t), z - (az + dz * t)) < thick) walled[i + j * nx] = 0;
      }
    }
  }
  /** The grid square nearest a spot that a body can stand on, looking a little way round it. */
  const squareAt = (grid: Uint8Array, x: number, z: number): number => {
    const [ci, cj] = [Math.round((x - minX) / step), Math.round((z - minZ) / step)];
    let [best, far] = [-1, Infinity];
    for (let j = Math.max(0, cj - 2); j <= Math.min(nz - 1, cj + 2); j += 1) {
      for (let i = Math.max(0, ci - 2); i <= Math.min(nx - 1, ci + 2); i += 1) {
        const d = Math.hypot(minX + i * step - x, minZ + j * step - z);
        if (grid[i + j * nx] && d < far) [best, far] = [i + j * nx, d];
      }
    }
    return best;
  };
  const queue = new Int32Array(nx * nz);
  /** Marks every square that can be walked to from one square, and says how many there are. */
  const spread = (grid: Uint8Array, from: number, mark: Uint8Array, value: number): number => {
    if (from < 0 || mark[from]) return 0;
    let [head, tail] = [0, 0];
    queue[tail++] = from;
    mark[from] = value;
    while (head < tail) {
      const at = queue[head++]!;
      const i = at % nx;
      const j = (at - i) / nx;
      for (let dj = -1; dj <= 1; dj += 1) {
        const nj = j + dj;
        if (nj < 0 || nj >= nz) continue;
        for (let di = -1; di <= 1; di += 1) {
          const ni = i + di;
          if (ni < 0 || ni >= nx) continue;
          const to = ni + nj * nx;
          if (!grid[to] || mark[to]) continue;
          mark[to] = value;
          queue[tail++] = to;
        }
      }
    }
    return tail;
  };
  const start = squareAt(walled, entry[0], entry[1]);
  if (start < 0) return open(entry[0], entry[1]) ? "FORGE_ROOM_WAY" : null;
  const before = new Uint8Array(nx * nz);
  spread(bare, squareAt(bare, entry[0], entry[1]), before, 1);
  const after = new Uint8Array(nx * nz);
  spread(walled, start, after, 1);
  // The middle of every room, and every spot that has to be reached.
  for (const [x, z] of [...floor.rooms.map((room) => room.at), ...must.filter(([mx, mz]) => open(mx, mz))]) {
    const square = squareAt(walled, x, z);
    if (square < 0 || !after[square]) return "FORGE_ROOM_SHUT";
  }
  // Any part of the floor that could be walked to before her walls and cannot be now. A scrap smaller than a person needs is not counted.
  for (let at = 0; at < walled.length; at += 1) {
    if (!walled[at] || !before[at] || after[at]) continue;
    if (spread(walled, at, after, 2) >= 40) return "FORGE_ROOM_SHUT";
  }
  return null;
}
