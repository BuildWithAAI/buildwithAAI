import type { Hand } from "./hand";
import { append, emptyMesh, MATERIALS, type MaterialName, type Mesh, type Vec3 } from "./mesh";
import { loft, type ProfileSpec } from "./shape";

/**
 * Her roads.
 *
 * A road is a line she draws on the ground, and one of three kinds. The forge lays the surface along
 * that line, and the same line is what her road network is made of. So what joins in the network
 * joins on the ground, and the other way round.
 *
 * Nothing here chooses for her. Where a road runs, how long it is, how wide and what kind are hers.
 */

export const ROAD_TYPES = ["avenue", "street", "alley"] as const;
export type RoadType = (typeof ROAD_TYPES)[number];

export const ROADS = {
  /** Width of the bed in metres: the least, the most, and what she gets if she does not say. */
  width: { avenue: [11, 24, 14], street: [6, 10, 7.5], alley: [2.5, 6, 4] } as Record<RoadType, readonly [number, number, number]>,
  /** A pale kerb each side of an avenue or a street. An alley has none. */
  kerb: 0.7,
  /** Two roads are joined when their surfaces touch or come this close, in metres. */
  join: 0.5,
  /** Points on a line may not be closer together than this. */
  step: 3,
} as const;

export type RoadSpec = { type: RoadType; /** The line, in the build's own metres: [x, z] points. */ through: [number, number][]; width?: number; /** Bend smoothly through the points instead of turning at each one. */ curve?: boolean };
/** One straight piece of a road where it lies in the world, with half the width of its surface. `run` says which line of its build it belongs to. */
export type Piece = { ax: number; az: number; bx: number; bz: number; half: number; run: number };
type Point = [number, number];
type Box = { x: number; z: number; turn: number; hw: number; hd: number };

export function roadWidth(spec: RoadSpec): number {
  const [least, most, usual] = ROADS.width[spec.type];
  return Math.min(most, Math.max(least, spec.width ?? usual));
}

/** Half the width of everything a road lays down: its bed and its kerbs. */
export function roadHalf(spec: RoadSpec): number {
  return roadWidth(spec) / 2 + (spec.type === "alley" ? 0 : ROADS.kerb);
}

/** The centre line the surface is laid along. A turn is rounded, so a road bends instead of pinching. */
export function roadLine(spec: RoadSpec): Point[] {
  const points = spec.through;
  const n = points.length;
  if (n === 2) return points.map(([x, z]) => [x, z]);
  const out: Point[] = [];
  if (spec.curve) {
    const at = (i: number) => points[Math.min(n - 1, Math.max(0, i))]!;
    const count = Math.min(160, (n - 1) * 8 + 1);
    for (let k = 0; k < count; k += 1) {
      const t = (k / (count - 1)) * (n - 1);
      const i = Math.min(Math.floor(t), n - 2);
      const f = t - i;
      const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
      const one = (d: 0 | 1) => 0.5 * (2 * p1[d] + (-p0[d] + p2[d]) * f + (2 * p0[d] - 5 * p1[d] + 4 * p2[d] - p3[d]) * f * f + (-p0[d] + 3 * p1[d] - 3 * p2[d] + p3[d]) * f * f * f);
      out.push([one(0), one(1)]);
    }
    return out;
  }
  const radius = roadWidth(spec);
  out.push([points[0]![0], points[0]![1]]);
  for (let i = 1; i < n - 1; i += 1) {
    const [a, b, c] = [points[i - 1]!, points[i]!, points[i + 1]!];
    const before = Math.hypot(a[0] - b[0], a[1] - b[1]);
    const after = Math.hypot(c[0] - b[0], c[1] - b[1]);
    const bend = Math.abs((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])) / (before * after);
    if (bend < 0.02) {
      out.push([b[0], b[1]]);
      continue;
    }
    const cut = Math.min(radius, before / 2, after / 2);
    const from: Point = [b[0] + ((a[0] - b[0]) / before) * cut, b[1] + ((a[1] - b[1]) / before) * cut];
    const to: Point = [b[0] + ((c[0] - b[0]) / after) * cut, b[1] + ((c[1] - b[1]) / after) * cut];
    for (let k = 0; k <= 6; k += 1) {
      const t = k / 6;
      out.push([(1 - t) * (1 - t) * from[0] + 2 * t * (1 - t) * b[0] + t * t * to[0], (1 - t) * (1 - t) * from[1] + 2 * t * (1 - t) * b[1] + t * t * to[1]]);
    }
  }
  out.push([points[n - 1]![0], points[n - 1]![1]]);
  return out;
}

/** A line beside another, `by` metres to one side. */
function beside(line: Point[], by: number): Point[] {
  return line.map((p, i) => {
    const a = line[Math.max(0, i - 1)]!;
    const b = line[Math.min(line.length - 1, i + 1)]!;
    const far = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [p[0] - ((b[1] - a[1]) / far) * by, p[1] + ((b[0] - a[0]) / far) * by];
  });
}

/** The same line with a point at least every few metres, so no stretch of surface is one very long flat face. Her viewport draws those badly from low down. */
function stepped(line: Point[], most = 6): Point[] {
  const out: Point[] = [line[0]!];
  for (let i = 1; i < line.length; i += 1) {
    const [a, b] = [line[i - 1]!, line[i]!];
    const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / most));
    for (let k = 1; k <= steps; k += 1) out.push([a[0] + ((b[0] - a[0]) * k) / steps, a[1] + ((b[1] - a[1]) * k) / steps]);
  }
  return out;
}

/** The surface: a dark bed, her light along it, and a pale kerb each side unless it is an alley. It lies low, so it blocks nothing. */
export function roadMesh(spec: RoadSpec, hand: Hand): Mesh {
  const mesh = emptyMesh();
  const line = stepped(roadLine(spec));
  const width = roadWidth(spec);
  const lay = (points: Point[], y: number, material: MaterialName, from: ProfileSpec, segments: number) =>
    append(mesh, loft({ through: points.map(([x, z]) => [x, y, z] as Vec3), smooth: false, from, segments }, MATERIALS.indexOf(material), hand));
  lay(line, 0.08, "dark", { shape: "block", width, depth: 0.16, soft: 0.2 }, 8);
  if (spec.type === "avenue") {
    for (const side of [-1, 1]) lay(beside(line, side * 1.1), 0.18, "glow", { shape: "block", width: 0.22, depth: 0.05 }, 6);
  } else lay(line, 0.18, "glow", { shape: "block", width: spec.type === "alley" ? 0.14 : 0.22, depth: 0.05 }, 6);
  if (spec.type !== "alley") {
    for (const side of [-1, 1]) lay(beside(line, side * (width / 2 + ROADS.kerb / 2)), 0.14, "stone", { shape: "block", width: ROADS.kerb, depth: 0.28, soft: 0.4 }, 8);
  }
  return mesh;
}

/** A road's line as straight pieces, where the build stands in the world. */
export function roadPieces(spec: RoadSpec, place: { x: number; z: number; turn: number }, run = 0): Piece[] {
  const a = (place.turn * Math.PI) / 180;
  const line = roadLine(spec).map(([lx, lz]): Point => [place.x + lx * Math.cos(a) + lz * Math.sin(a), place.z - lx * Math.sin(a) + lz * Math.cos(a)]);
  const half = roadHalf(spec);
  return line.slice(1).map((b, i) => ({ ax: line[i]![0], az: line[i]![1], bx: b[0], bz: b[1], half, run }));
}

function pointToPiece(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const long = dx * dx + dz * dz;
  const t = long < 1e-12 ? 0 : Math.min(1, Math.max(0, ((px - ax) * dx + (pz - az) * dz) / long));
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}

/** How far apart two straight lines are. Nothing, if they cross. */
function apart(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): number {
  const side = (px: number, pz: number, qx: number, qz: number, rx: number, rz: number) => (qx - px) * (rz - pz) - (qz - pz) * (rx - px);
  const [d1, d2, d3, d4] = [side(cx, cz, dx, dz, ax, az), side(cx, cz, dx, dz, bx, bz), side(ax, az, bx, bz, cx, cz), side(ax, az, bx, bz, dx, dz)];
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  return Math.min(pointToPiece(ax, az, cx, cz, dx, dz), pointToPiece(bx, bz, cx, cz, dx, dz), pointToPiece(cx, cz, ax, az, bx, bz), pointToPiece(dx, dz, ax, az, bx, bz));
}

/** Whether a point is beside a piece that runs much the same way as `dir`, within `gap` of its surface. A point past either end is not beside it. */
export function alongside(piece: Piece, x: number, z: number, dir: [number, number], gap: number): boolean {
  const dx = piece.bx - piece.ax;
  const dz = piece.bz - piece.az;
  const long = Math.hypot(dx, dz) || 1;
  if (Math.abs((dx * dir[0] + dz * dir[1]) / long) < 0.7) return false;
  const t = ((x - piece.ax) * dx + (z - piece.az) * dz) / (long * long);
  return t >= 0 && t <= 1 && Math.abs((x - piece.ax) * dz - (z - piece.az) * dx) / long <= piece.half + gap;
}

/** Whether the surfaces of two pieces touch, or come within `slack` of each other. */
export function piecesMeet(a: Piece, b: Piece, slack: number = ROADS.join): boolean {
  return apart(a.ax, a.az, a.bx, a.bz, b.ax, b.az, b.bx, b.bz) <= a.half + b.half + slack;
}

/** Whether any piece of one road touches any piece of another. */
export function roadsMeet(a: Piece[], b: Piece[], slack: number = ROADS.join): boolean {
  return a.some((p) => b.some((q) => piecesMeet(p, q, slack)));
}

/** Whether a road piece's surface runs under a turned box, or within `gap` of it. */
export function pieceMeetsBox(piece: Piece, box: Box, gap = 0): boolean {
  const a = (box.turn * Math.PI) / 180;
  const local = (x: number, z: number): Point => [(x - box.x) * Math.cos(a) - (z - box.z) * Math.sin(a), (x - box.x) * Math.sin(a) + (z - box.z) * Math.cos(a)];
  const [p, q] = [local(piece.ax, piece.az), local(piece.bx, piece.bz)];
  const within = ([x, z]: Point) => Math.abs(x) <= box.hw && Math.abs(z) <= box.hd;
  if (within(p) || within(q)) return true;
  const rim: Point[] = [[-box.hw, -box.hd], [box.hw, -box.hd], [box.hw, box.hd], [-box.hw, box.hd]];
  return rim.some((from, i) => apart(p[0], p[1], q[0], q[1], from[0], from[1], rim[(i + 1) % 4]![0], rim[(i + 1) % 4]![1]) <= piece.half + gap);
}

/** Whether a build's roads are all one piece: every line in it reaches every other. */
export function onePiece(pieces: Piece[]): boolean {
  const runs = [...new Set(pieces.map((piece) => piece.run))];
  if (runs.length < 2) return true;
  const reached = new Set([runs[0]!]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const run of runs) {
      if (reached.has(run)) continue;
      const mine = pieces.filter((piece) => piece.run === run);
      if (!roadsMeet(mine, pieces.filter((piece) => reached.has(piece.run)))) continue;
      reached.add(run);
      grew = true;
    }
  }
  return reached.size === runs.length;
}
