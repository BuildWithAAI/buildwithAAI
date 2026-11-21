import { rng } from "../form/genome";
import type { Hand } from "./hand";
import { add, cross, dot, emptyMesh, MATERIALS, scale, sub, triangle, turnAbout, unit, vertex, type Mesh, type Vec3 } from "./mesh";

/**
 * The shaping tools. There are three, and between them they make almost anything:
 *
 * - loft: a flat outline carried along a path, changing as it goes. Straight up it is a tower or a wall.
 *   Along a curve it is a rail, a pipe, an arch or a track. The outline can turn, shrink, swell and
 *   change from one shape into another on the way.
 * - spin: a side-view outline turned around an upright axis. Domes, bowls, tanks, columns, rings.
 * - ground: a sheet of land with relief. Dunes, furrows, craters, pools, terraces.
 *
 * Her hand is applied here, so nothing leaves these tools without it.
 */

export type Point2 = [number, number];
const TAU = Math.PI * 2;
const id = (name: (typeof MATERIALS)[number]) => MATERIALS.indexOf(name);
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const smooth = (t: number) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};

/** A flat outline. "round" is an ellipse, "sided" a polygon, "block" a rectangle. `soft` rounds the corners; `lobes` and `ripple` scallop the edge. */
export type ProfileSpec = { shape?: "round" | "sided" | "block"; width: number; depth?: number; sides?: number; soft?: number; lobes?: number; ripple?: number };

/** Always `count` points, starting at the same place and going the same way, so any two outlines can be blended point by point. */
export function profile(spec: ProfileSpec, count: number): Point2[] {
  const a = spec.width / 2;
  const b = (spec.depth ?? spec.width) / 2;
  const shape = spec.shape ?? "round";
  const soft = clamp(spec.soft ?? 0.25, 0, 1);
  const sides = clamp(Math.round(spec.sides ?? 6), 3, 16);
  const out: Point2[] = [];
  for (let i = 0; i < count; i += 1) {
    const angle = (TAU * i) / count;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    let x = c;
    let z = s;
    if (shape === "sided") {
      const step = TAU / sides;
      const local = (((angle % step) + step) % step) - step / 2;
      const flat = Math.cos(step / 2) / Math.cos(local);
      const r = flat + (1 - flat) * soft;
      x = c * r;
      z = s * r;
    } else if (shape === "block") {
      const power = 2 / (2 + (1 - soft) * 10);
      x = Math.sign(c) * Math.abs(c) ** power;
      z = Math.sign(s) * Math.abs(s) ** power;
    }
    const wave = 1 + (spec.ripple ?? 0) * Math.cos((spec.lobes ?? 0) * angle);
    out.push([x * a * wave, z * b * wave]);
  }
  return out;
}

function spline(points: Vec3[], closed: boolean, count: number): Vec3[] {
  const n = points.length;
  const at = (i: number) => (closed ? points[((i % n) + n) % n]! : points[clamp(i, 0, n - 1)]!);
  const out: Vec3[] = [];
  for (let k = 0; k < count; k += 1) {
    const t = closed ? (k / count) * n : (k / (count - 1)) * (n - 1);
    const i = Math.min(Math.floor(t), closed ? n - 1 : n - 2);
    const f = t - i;
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    const p: Vec3 = [0, 0, 0];
    for (let d = 0; d < 3; d += 1) {
      p[d] = 0.5 * (2 * p1[d]! + (-p0[d]! + p2[d]!) * f + (2 * p0[d]! - 5 * p1[d]! + 4 * p2[d]! - p3[d]!) * f * f + (-p0[d]! + 3 * p1[d]! - 3 * p2[d]! + p3[d]!) * f * f * f);
    }
    out.push(p);
  }
  return out;
}

type Frame = { p: Vec3; t: Vec3; n: Vec3; b: Vec3 };

/** A frame at each station that turns as little as the path allows, so a rail does not corkscrew. On a closed path the leftover turn is spread evenly so the ends meet. */
function frames(points: Vec3[], closed: boolean): Frame[] {
  const n = points.length;
  const tangent = (i: number): Vec3 => {
    const before = closed ? points[(i - 1 + n) % n]! : points[Math.max(0, i - 1)]!;
    const after = closed ? points[(i + 1) % n]! : points[Math.min(n - 1, i + 1)]!;
    return unit(sub(after, before));
  };
  const t0 = tangent(0);
  const ref: Vec3 = Math.abs(t0[1]) > 0.9 ? [0, 0, 1] : [0, 1, 0];
  let normal = unit(sub(ref, scale(t0, dot(ref, t0))));
  const out: Frame[] = [{ p: points[0]!, t: t0, n: normal, b: cross(t0, normal) }];
  const carry = (from: Vec3, to: Vec3, tFrom: Vec3, tTo: Vec3, r: Vec3): Vec3 => {
    const v1 = sub(to, from);
    const c1 = dot(v1, v1);
    if (c1 < 1e-18) return r;
    const rL = sub(r, scale(v1, (2 / c1) * dot(v1, r)));
    const tL = sub(tFrom, scale(v1, (2 / c1) * dot(v1, tFrom)));
    const v2 = sub(tTo, tL);
    const c2 = dot(v2, v2);
    return c2 < 1e-18 ? rL : sub(rL, scale(v2, (2 / c2) * dot(v2, rL)));
  };
  for (let i = 1; i < n; i += 1) {
    const t = tangent(i);
    normal = unit(carry(points[i - 1]!, points[i]!, out[i - 1]!.t, t, normal));
    out.push({ p: points[i]!, t, n: normal, b: cross(t, normal) });
  }
  if (closed && n > 2) {
    const back = unit(carry(points[n - 1]!, points[0]!, out[n - 1]!.t, t0, normal));
    const first = out[0]!.n;
    const miss = Math.atan2(dot(cross(first, back), t0), dot(first, back));
    for (let i = 0; i < n; i += 1) {
      const fixed = turnAbout(out[i]!.n, out[i]!.t, (-miss * i) / n);
      out[i] = { ...out[i]!, n: fixed, b: cross(out[i]!.t, fixed) };
    }
  }
  return out;
}

/** Joins a stack of rings into a skin. Each ring has the same number of points. */
export function skin(mesh: Mesh, rings: Vec3[][], material: number, options: { closed?: boolean; capStart?: boolean; capEnd?: boolean } = {}): void {
  const n = rings[0]!.length;
  const base = rings.map((ring) => {
    const first = mesh.positions.length / 3;
    for (const p of ring) vertex(mesh, p);
    return first;
  });
  const last = options.closed ? rings.length : rings.length - 1;
  for (let r = 0; r < last; r += 1) {
    const lower = base[r]!;
    const upper = base[(r + 1) % rings.length]!;
    for (let i = 0; i < n; i += 1) {
      const j = (i + 1) % n;
      triangle(mesh, lower + i, upper + j, lower + j, material);
      triangle(mesh, lower + i, upper + i, upper + j, material);
    }
  }
  const cap = (ring: Vec3[], end: boolean) => {
    const centre = scale(ring.reduce((sum, p) => add(sum, p), [0, 0, 0] as Vec3), 1 / n);
    const c = vertex(mesh, centre);
    const first = mesh.positions.length / 3;
    for (const p of ring) vertex(mesh, p);
    for (let i = 0; i < n; i += 1) {
      const j = (i + 1) % n;
      if (end) triangle(mesh, c, first + j, first + i, material);
      else triangle(mesh, c, first + i, first + j, material);
    }
  };
  if (!options.closed && options.capStart) cap(rings[0]!, false);
  if (!options.closed && options.capEnd) cap(rings[rings.length - 1]!, true);
}

/** A small eight-sided light. */
function light(mesh: Mesh, at: Vec3, size: number): void {
  const m = id("glow");
  const tips: Vec3[] = [[size, 0, 0], [-size, 0, 0], [0, size, 0], [0, -size, 0], [0, 0, size], [0, 0, -size]];
  const [px, nx, py, ny, pz, nz] = tips.map((tip) => vertex(mesh, add(at, tip))) as [number, number, number, number, number, number];
  for (const [a, b, c] of [[px, py, pz], [pz, py, nx], [nx, py, nz], [nz, py, px], [pz, ny, px], [nx, ny, pz], [nz, ny, nx], [px, ny, nz]] as const) triangle(mesh, a, b, c, m);
}

export type LoftSpec = {
  /** Straight up by this much. */
  up?: number;
  /** Or along these points. */
  through?: Vec3[];
  closed?: boolean;
  smooth?: boolean;
  from: ProfileSpec;
  to?: ProfileSpec;
  rings?: number;
  segments?: number;
  /** Size at the far end as a share of the start. */
  taper?: number;
  swell?: number;
  /** Degrees the outline turns over the whole length. */
  twist?: number;
  cap?: "flat" | "crown" | "open";
  /** Rings of light around an upright shaft. */
  bands?: number;
  /** 0 to 1: how much of her hand this part takes. Default 1. */
  hand?: number;
};

export function loft(spec: LoftSpec, material: number, hand: Hand): Mesh {
  const mesh = emptyMesh();
  const strength = clamp(spec.hand ?? 1, 0, 1);
  const upright = !spec.through;
  const cap = spec.cap ?? (upright ? "crown" : "flat");
  const segments = clamp(Math.round(spec.segments ?? (cap === "crown" ? 64 : 32)), 6, 96);
  const closed = Boolean(spec.through && spec.closed);
  let centres: Vec3[];
  if (upright) {
    const count = clamp(Math.round(spec.rings ?? 14), 2, 160);
    const height = spec.up ?? 1;
    centres = Array.from({ length: count }, (_, i) => [0, (height * i) / (count - 1), 0] as Vec3);
  } else {
    const points = spec.through!;
    const count = clamp(Math.round(spec.rings ?? points.length * 8), Math.max(2, closed ? 3 : 2), 200);
    centres = spec.smooth === false ? points : spline(points, closed, count);
  }
  const stations = frames(centres, closed);
  const start = profile(spec.from, segments);
  const finish = profile(spec.to ?? spec.from, segments);
  const taper = spec.taper ?? 1;
  const swell = spec.swell ?? (upright ? hand.swell * strength : 0);
  const twist = ((spec.twist ?? 0) * Math.PI) / 180;
  const ringAt = (frame: Frame, t: number, grow = 1): Vec3[] => {
    const size = (1 + (taper - 1) * t) * (1 + swell * Math.sin(Math.PI * t)) * grow;
    const turn = twist * t;
    const c = Math.cos(turn);
    const s = Math.sin(turn);
    return start.map((from, i) => {
      const to = finish[i]!;
      const u = (from[0] + (to[0] - from[0]) * t) * size;
      const v = (from[1] + (to[1] - from[1]) * t) * size;
      return add(frame.p, add(scale(frame.b, u * c - v * s), scale(frame.n, u * s + v * c)));
    });
  };
  const count = stations.length;
  const rings = stations.map((frame, i) => ringAt(frame, closed ? i / count : i / (count - 1)));
  skin(mesh, rings, material, { closed, capStart: cap !== "open", capEnd: cap === "flat" });

  if (upright && spec.bands) {
    // Her bands of light: thin belts just proud of the shaft.
    const height = spec.up ?? 1;
    const belt = Math.min(0.3, height * 0.01);
    const total = clamp(Math.round(spec.bands), 0, 40);
    for (let k = 1; k <= total; k += 1) {
      const t = k / (total + 1);
      const low: Frame = { ...stations[0]!, p: [0, height * t - belt / 2, 0] };
      const high: Frame = { ...stations[0]!, p: [0, height * t + belt / 2, 0] };
      skin(mesh, [ringAt(low, t, 1.015), ringAt(high, t, 1.015)], id("glow"));
    }
  }

  if (cap === "crown" && !closed) {
    // Her crown: the rim flares and scallops, then closes in a dome, like the bell she is.
    const frame = stations[count - 1]!;
    const rim = ringAt(frame, 1);
    const radius = rim.reduce((sum, p) => sum + Math.hypot(...sub(p, frame.p)), 0) / rim.length;
    const height = Math.max(0.2, radius * 2 * hand.crown * (0.4 + 0.6 * strength));
    const flare = 1 + hand.flare * strength;
    const steps: [number, number, number][] = [[flare, 0.05, 1], [flare * 0.985, 0.17, 0.5], [flare * 0.86, 0.42, 0], [flare * 0.62, 0.7, 0], [flare * 0.3, 0.92, 0], [flare * 0.04, 1, 0]];
    const crown: Vec3[][] = [rim];
    for (const [grow, lift, scallop] of steps) {
      crown.push(rim.map((p, i) => {
        const wave = 1 + hand.ripple * strength * scallop * Math.cos((hand.lobes * TAU * i) / rim.length);
        return add(add(frame.p, scale(sub(p, frame.p), grow * wave)), scale(frame.t, height * lift));
      }));
    }
    const crownMaterial = [id("glass"), id("body"), id("water"), id("glow")].includes(material) ? material : id("body");
    skin(mesh, crown, crownMaterial, { capEnd: true });
    const lights = Math.round(hand.lights * strength);
    for (let k = 0; k < lights; k += 1) {
      const angle = (TAU * Math.round((k * hand.lobes) / lights)) / hand.lobes;
      const out = add(scale(frame.b, Math.cos(angle)), scale(frame.n, Math.sin(angle)));
      light(mesh, add(add(frame.p, scale(out, radius * flare * (1 + hand.ripple * strength))), scale(frame.t, height * 0.05)), Math.max(0.05, radius * 0.07));
    }
  }
  return mesh;
}

export type SpinSpec = { outline: Point2[]; segments?: number; smooth?: boolean; ripple?: number; cap?: "flat" | "open" | "top-open"; hand?: number };

/** `outline` is a list of [distance from the axis, height]. */
export function spin(spec: SpinSpec, material: number, hand: Hand): Mesh {
  const mesh = emptyMesh();
  const segments = clamp(Math.round(spec.segments ?? 64), 6, 96);
  let outline = spec.outline;
  if (spec.smooth !== false && outline.length > 2) {
    outline = spline(outline.map(([r, y]) => [r, y, 0] as Vec3), false, clamp(outline.length * 5, 8, 120)).map((p) => [p[0], p[1]] as Point2);
  }
  const ripple = spec.ripple ?? 0;
  const rings = outline.map(([r, y]) => {
    const radius = Math.max(0.001, r);
    return Array.from({ length: segments }, (_, i) => {
      const angle = (TAU * i) / segments;
      const wave = 1 + ripple * Math.cos(hand.lobes * angle);
      return [Math.cos(angle) * radius * wave, y, Math.sin(angle) * radius * wave] as Vec3;
    });
  });
  // The skin faces outward when the outline climbs. One that is given top first is turned over.
  if (outline[outline.length - 1]![1] < outline[0]![1]) rings.reverse();
  const cap = spec.cap ?? "flat";
  skin(mesh, rings, material, { capStart: cap !== "open", capEnd: cap === "flat" });
  return mesh;
}

function hashCell(x: number, z: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** Her own noise: smooth, repeatable, between -1 and 1. */
export function noise(x: number, z: number, seed: number): number {
  let total = 0;
  let size = 1;
  let weight = 0.5;
  for (let octave = 0; octave < 3; octave += 1) {
    const fx = x * size;
    const fz = z * size;
    const x0 = Math.floor(fx);
    const z0 = Math.floor(fz);
    const tx = smooth(fx - x0);
    const tz = smooth(fz - z0);
    const a = hashCell(x0, z0, seed + octave);
    const b = hashCell(x0 + 1, z0, seed + octave);
    const c = hashCell(x0, z0 + 1, seed + octave);
    const d = hashCell(x0 + 1, z0 + 1, seed + octave);
    total += (a + (b - a) * tx + (c - a + (a - b + d - c) * tx) * tz) * weight;
    size *= 2;
    weight *= 0.5;
  }
  return (total / 0.875) * 2 - 1;
}

export type GroundSpec = { width: number; depth?: number; kind?: "flat" | "dunes" | "rows" | "crater" | "pool" | "terraces"; relief?: number; cells?: number; seed?: number; rows?: number; round?: boolean };

export function groundHeight(spec: GroundSpec, x: number, z: number): number {
  const half = spec.width / 2;
  const halfDepth = (spec.depth ?? spec.width) / 2;
  const relief = spec.relief ?? 1;
  const seed = spec.seed ?? 1;
  const d = Math.hypot(x / half, z / halfDepth);
  const n = noise(x * 0.22, z * 0.22, seed);
  let h = 0;
  if (spec.kind === "dunes") h = relief * (0.55 * n + 0.45 * Math.sin(x * 0.4 + n * 2.2));
  else if (spec.kind === "rows") h = relief * (0.5 + 0.5 * Math.sin((x / spec.width) * TAU * (spec.rows ?? 8))) * 0.7 + relief * 0.08 * n;
  else if (spec.kind === "crater") h = relief * (Math.exp(-(((d - 0.55) / 0.13) ** 2)) - 0.85 * Math.exp(-((d / 0.4) ** 2)));
  else if (spec.kind === "pool") h = -relief * smooth(1 - d / 0.8);
  else if (spec.kind === "terraces") h = (Math.floor((n * 0.5 + 0.5) * 5) / 5) * relief;
  // It meets level ground at its edge.
  return h * smooth((1 - d) / 0.18);
}

export function ground(spec: GroundSpec, material: number): Mesh {
  const mesh = emptyMesh();
  const cells = clamp(Math.round(spec.cells ?? 40), 2, 96);
  const half = spec.width / 2;
  const halfDepth = (spec.depth ?? spec.width) / 2;
  for (let j = 0; j <= cells; j += 1) {
    for (let i = 0; i <= cells; i += 1) {
      let u = (i / cells) * 2 - 1;
      let v = (j / cells) * 2 - 1;
      if (spec.round) [u, v] = [u * Math.sqrt(1 - (v * v) / 2), v * Math.sqrt(1 - (u * u) / 2)];
      const x = u * half;
      const z = v * halfDepth;
      vertex(mesh, [x, groundHeight(spec, x, z), z]);
    }
  }
  for (let j = 0; j < cells; j += 1) {
    for (let i = 0; i < cells; i += 1) {
      const a = j * (cells + 1) + i;
      const b = a + 1;
      const c = a + cells + 1;
      const d = c + 1;
      triangle(mesh, a, c, b, material);
      triangle(mesh, b, c, d, material);
    }
  }
  return mesh;
}

/**
 * The islet every build stands on: the underside of a bell, floating, with trails hanging down. The top
 * is level ground at height 0.
 */
export function islet(radius: number, hand: Hand, seed: number): Mesh {
  const mesh = emptyMesh();
  const R = radius;
  const under = spin({ outline: [[R * 0.12, -R * 0.6], [R * 0.5, -R * 0.5], [R * 0.86, -R * 0.3], [R * 1.05, -R * 0.1], [R * 1.04, -R * 0.02], [R, 0]], ripple: hand.ripple, cap: "top-open", segments: 96 }, MATERIALS.indexOf("body"), hand);
  for (let i = 0; i < under.positions.length; i += 1) mesh.positions.push(under.positions[i]!);
  mesh.indices.push(...under.indices);
  mesh.materials.push(...under.materials);
  const top = Array.from({ length: 96 }, (_, i) => {
    const angle = (TAU * i) / 96;
    const wave = 1 + hand.ripple * Math.cos(hand.lobes * angle);
    return [Math.cos(angle) * R * wave, 0, Math.sin(angle) * R * wave] as Vec3;
  });
  const centre = vertex(mesh, [0, 0, 0]);
  const first = mesh.positions.length / 3;
  for (const p of top) vertex(mesh, p);
  for (let i = 0; i < 96; i += 1) triangle(mesh, centre, first + ((i + 1) % 96), first + i, id("ground"));
  const next = rng(seed ^ 0x51ed27);
  for (let k = 0; k < hand.trails; k += 1) {
    const angle = (TAU * k) / hand.trails + next() * 0.3;
    const from = R * (0.3 + next() * 0.45);
    const reach = R * (0.5 + next() * 0.9);
    const phase = next() * TAU;
    const points: Vec3[] = [];
    for (let s = 0; s <= 5; s += 1) {
      const t = s / 5;
      const drift = Math.sin(t * 5 + phase) * hand.sway * R * 2 * t;
      points.push([Math.cos(angle) * from + drift, -R * 0.42 - reach * t, Math.sin(angle) * from + Math.cos(t * 4 + phase) * hand.sway * R * 2 * t]);
    }
    const trail = loft({ through: points, from: { width: Math.max(0.06, R * 0.03) }, taper: 0.25, segments: 6, rings: 14, cap: "flat" }, id(k % 3 === 0 ? "glow" : "body"), hand);
    const base = mesh.positions.length / 3;
    mesh.positions.push(...trail.positions);
    for (const index of trail.indices) mesh.indices.push(index + base);
    mesh.materials.push(...trail.materials);
  }
  return mesh;
}

/**
 * The path between two pieces of her land: an arched deck with a line of her light along it. Every
 * build is joined by one of these to the land it grew from, so nothing she raises stands alone.
 */
export function causeway(from: Vec3, to: Vec3, hand: Hand): Mesh {
  const mesh = emptyMesh();
  const span = Math.hypot(to[0] - from[0], to[2] - from[2]);
  if (span < 0.5) return mesh;
  const arch = Math.min(6, span * 0.07);
  const points: Vec3[] = [0, 0.25, 0.5, 0.75, 1].map((t) => [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t + arch * Math.sin(Math.PI * t), from[2] + (to[2] - from[2]) * t]);
  const lay = (part: Mesh) => {
    const base = mesh.positions.length / 3;
    mesh.positions.push(...part.positions);
    for (const index of part.indices) mesh.indices.push(index + base);
    mesh.materials.push(...part.materials);
  };
  const rings = clamp(Math.round(span / 2.5), 12, 60);
  lay(loft({ through: points, from: { shape: "block", width: 3.4, depth: 0.5, soft: 0.5 }, rings, segments: 12, cap: "flat", hand: 0 }, id("stone"), hand));
  lay(loft({ through: points.map(([x, y, z]) => [x, y + 0.42, z] as Vec3), from: { shape: "round", width: 0.32 }, rings, segments: 6, cap: "flat", hand: 0 }, id("glow"), hand));
  return mesh;
}
