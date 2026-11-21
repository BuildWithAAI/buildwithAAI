/**
 * The forge is her modelling engine: the part of the engine she builds her world with.
 *
 * This file is the ground it stands on. A mesh is a list of points, a list of triangles joining them,
 * and one material for each triangle. Everything she makes, from a fence post to a tower, ends up as one.
 */

export type Vec3 = [number, number, number];

/** The only materials there are. Every surface in her world is one of these, which is why it reads as one world. */
export const MATERIALS = ["stone", "metal", "glass", "body", "glow", "water", "ground", "dark"] as const;
export type MaterialName = (typeof MATERIALS)[number];

export type Mesh = { positions: number[]; indices: number[]; materials: number[] };

export function emptyMesh(): Mesh {
  return { positions: [], indices: [], materials: [] };
}

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export function unit(a: Vec3): Vec3 {
  const size = length(a);
  return size < 1e-12 ? [0, 1, 0] : [a[0] / size, a[1] / size, a[2] / size];
}

/** Turns a vector about an axis by an angle in radians. */
export function turnAbout(v: Vec3, axis: Vec3, angle: number): Vec3 {
  const k = unit(axis);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return add(add(scale(v, c), scale(cross(k, v), s)), scale(k, dot(k, v) * (1 - c)));
}

export function vertex(mesh: Mesh, p: Vec3): number {
  mesh.positions.push(p[0], p[1], p[2]);
  return mesh.positions.length / 3 - 1;
}

export function triangle(mesh: Mesh, a: number, b: number, c: number, material: number): void {
  mesh.indices.push(a, b, c);
  mesh.materials.push(material);
}

export function point(mesh: Mesh, index: number): Vec3 {
  return [mesh.positions[index * 3]!, mesh.positions[index * 3 + 1]!, mesh.positions[index * 3 + 2]!];
}

export function triangleCount(mesh: Mesh): number {
  return mesh.indices.length / 3;
}

/** Where a part sits: moved, turned (degrees: about the upright, then tipped forward, then rolled), and sized. */
export type Placement = { at?: Vec3; turn?: number; tip?: number; roll?: number; size?: number | Vec3 };

export function place(p: Vec3, where: Placement): Vec3 {
  const size = where.size ?? 1;
  let v: Vec3 = typeof size === "number" ? scale(p, size) : [p[0] * size[0], p[1] * size[1], p[2] * size[2]];
  if (where.roll) v = turnAbout(v, [0, 0, 1], (where.roll * Math.PI) / 180);
  if (where.tip) v = turnAbout(v, [1, 0, 0], (where.tip * Math.PI) / 180);
  if (where.turn) v = turnAbout(v, [0, 1, 0], (where.turn * Math.PI) / 180);
  return where.at ? add(v, where.at) : v;
}

/** Adds one mesh into another, placed. A mirrored copy has its triangles turned over so it still faces out. */
export function append(target: Mesh, source: Mesh, where: Placement = {}, mirror?: "x" | "z"): void {
  const base = target.positions.length / 3;
  for (let i = 0; i < source.positions.length; i += 3) {
    let p: Vec3 = [source.positions[i]!, source.positions[i + 1]!, source.positions[i + 2]!];
    if (mirror === "x") p = [-p[0], p[1], p[2]];
    if (mirror === "z") p = [p[0], p[1], -p[2]];
    const q = place(p, where);
    target.positions.push(q[0], q[1], q[2]);
  }
  for (let i = 0; i < source.indices.length; i += 3) {
    const a = source.indices[i]! + base;
    const b = source.indices[i + 1]! + base;
    const c = source.indices[i + 2]! + base;
    if (mirror) target.indices.push(a, c, b);
    else target.indices.push(a, b, c);
    target.materials.push(source.materials[i / 3]!);
  }
}

export function bounds(mesh: Mesh): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.positions.length; i += 3) {
    for (let k = 0; k < 3; k += 1) {
      const value = mesh.positions[i + k]!;
      if (value < min[k]!) min[k] = value;
      if (value > max[k]!) max[k] = value;
    }
  }
  return mesh.positions.length ? { min, max } : { min: [0, 0, 0], max: [0, 0, 0] };
}

/** One direction per point, the average of the faces that meet there. Shared points shade smoothly; separate points make a crisp edge. */
export function pointNormals(mesh: Mesh): Float32Array {
  const normals = new Float32Array(mesh.positions.length);
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const ia = mesh.indices[i]!;
    const ib = mesh.indices[i + 1]!;
    const ic = mesh.indices[i + 2]!;
    const n = cross(sub(point(mesh, ib), point(mesh, ia)), sub(point(mesh, ic), point(mesh, ia)));
    for (const index of [ia, ib, ic]) {
      normals[index * 3] = normals[index * 3]! + n[0];
      normals[index * 3 + 1] = normals[index * 3 + 1]! + n[1];
      normals[index * 3 + 2] = normals[index * 3 + 2]! + n[2];
    }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const n = unit([normals[i]!, normals[i + 1]!, normals[i + 2]!]);
    normals[i] = n[0];
    normals[i + 1] = n[1];
    normals[i + 2] = n[2];
  }
  return normals;
}

/** Every number finite and every triangle pointing at real points. */
export function soundMesh(mesh: Mesh): boolean {
  const count = mesh.positions.length / 3;
  if (mesh.indices.length % 3 !== 0 || mesh.materials.length !== mesh.indices.length / 3) return false;
  if (mesh.positions.some((value) => !Number.isFinite(value))) return false;
  if (mesh.indices.some((index) => !Number.isInteger(index) || index < 0 || index >= count)) return false;
  return mesh.materials.every((id) => Number.isInteger(id) && id >= 0 && id < MATERIALS.length);
}

/**
 * The mesh as bytes for the world's renderer: "ZMSH", counts, points, then triangles grouped by material
 * with a table saying where each group starts.
 */
export function encodeMesh(mesh: Mesh): Buffer {
  const points = mesh.positions.length / 3;
  const triangles = triangleCount(mesh);
  const order = [...mesh.materials.keys()].sort((a, b) => mesh.materials[a]! - mesh.materials[b]! || a - b);
  const out = Buffer.alloc(12 + MATERIALS.length * 4 + points * 12 + triangles * 12);
  out.write("ZMSH", 0, "latin1");
  out.writeUInt32LE(points, 4);
  out.writeUInt32LE(triangles, 8);
  const counts = new Array<number>(MATERIALS.length).fill(0);
  for (const id of mesh.materials) counts[id] = counts[id]! + 1;
  counts.forEach((count, id) => out.writeUInt32LE(count, 12 + id * 4));
  let at = 12 + MATERIALS.length * 4;
  for (const value of mesh.positions) {
    out.writeFloatLE(value, at);
    at += 4;
  }
  for (const t of order) {
    for (let k = 0; k < 3; k += 1) {
      out.writeUInt32LE(mesh.indices[t * 3 + k]!, at);
      at += 4;
    }
  }
  return out;
}
