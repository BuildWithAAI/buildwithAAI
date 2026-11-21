import { Surface, type Rgb } from "../form/raster";
import type { Style } from "../form/style";
import type { Look } from "./hand";
import { LIGHT, lit as herLit } from "./light";
import { add, bounds, cross, dot, MATERIALS, pointNormals, scale, sub, unit, type Mesh, type Vec3 } from "./mesh";

/**
 * Her viewport. It draws a mesh as a picture with no graphics card and no drawing library: every
 * triangle is projected, filled and depth-tested here.
 *
 * It is also where her world's light is written down, once. Surfaces are lit from one side, filled from
 * the sky above and the water below, and brighten where they turn away from the eye, the way her own
 * body does. Distance fades into her water colour. The world's live renderer is meant to match this.
 */

export type ViewOptions = { width: number; height?: number; /** Degrees around the build. */ around?: number; /** Degrees above the horizon. */ above?: number; /** How far the build floats above the sea. */ lift?: number; /** How wide the light it casts on the water is. */ pool?: number; /** Above 1 moves the eye closer. */ zoom?: number };

function rgb(hex: string): Rgb {
  return [Number.parseInt(hex.slice(1, 3), 16) / 255, Number.parseInt(hex.slice(3, 5), 16) / 255, Number.parseInt(hex.slice(5, 7), 16) / 255];
}
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** `looks` may be one look, or several: a triangle's material number then counts on past the first eight into the next look. */
export function renderMesh(mesh: Mesh, looks: Look | Look[], style: Style, options: ViewOptions): Surface {
  const all = Array.isArray(looks) ? looks : [looks];
  const look = all[0]!;
  const surfaceOf = (material: number) => (all[Math.floor(material / MATERIALS.length)] ?? look)[MATERIALS[material % MATERIALS.length]!];
  const W = options.width;
  const H = options.height ?? Math.round(W * 1.25);
  const SS = 2;
  const w = W * SS;
  const h = H * SS;
  const lift = options.lift ?? 1.2;
  const box = bounds(mesh);
  // Framed on what is above the water, so the whole build and the underside of its islet are in view.
  const low = Math.max(box.min[1] + lift, 0);
  const high = box.max[1] + lift;
  const centre: Vec3 = [(box.min[0] + box.max[0]) / 2, (low + high) / 2, (box.min[2] + box.max[2]) / 2];
  const around = ((options.around ?? 35) * Math.PI) / 180;
  const above = ((options.above ?? 12) * Math.PI) / 180;
  const fov = (40 * Math.PI) / 180;
  const ball = Math.hypot(box.max[0] - box.min[0], high - low, box.max[2] - box.min[2]) / 2;
  const reach = ball * 2;
  const distance = ((ball / Math.sin(fov / 2)) * 0.86) / Math.min(4, Math.max(0.25, options.zoom ?? 1));
  const eye = add(centre, [Math.cos(around) * Math.cos(above) * distance, Math.sin(above) * distance, Math.sin(around) * Math.cos(above) * distance]);
  const forward = unit(sub(centre, eye));
  const right = unit(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  const focal = h / 2 / Math.tan(fov / 2);
  const near = 0.05;

  const deep = rgb(style.palette.deep);
  const accent = rgb(look.glow.color);
  const sea = mix(deep, rgb(look.water.color), 0.16);
  const haze = mix(rgb(style.palette.pool), rgb(style.palette.body), 0.38);
  const fogFar = distance * 4;
  const fog = (depth: number) => Math.min(0.92, Math.max(0, (depth - distance * 0.9) / fogFar));
  const pool = options.pool ?? reach * 0.5;
  void reach;

  const colour = new Float32Array(w * h * 3);
  const depthAt = new Float32Array(w * h).fill(Infinity);
  // Sky and sea, worked out for every point from the direction it looks in.
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const dir = unit(add(add(scale(right, x + 0.5 - w / 2), scale(up, h / 2 - y - 0.5)), scale(forward, focal)));
      let c: Rgb;
      if (dir[1] < -1e-4) {
        const t = -eye[1] / dir[1];
        const depth = t * dot(dir, forward);
        depthAt[y * w + x] = depth;
        const hx = eye[0] + dir[0] * t;
        const hz = eye[2] + dir[2] * t;
        const ripple = 0.5 + 0.5 * Math.sin(hx * 0.6 + Math.sin(hz * 0.35) * 1.5) * Math.sin(hz * 0.5);
        // The water under a build is lit by it.
        const cast = Math.exp(-((hx * hx + hz * hz) / (pool * pool))) * 0.5;
        c = mix(mix(mix(sea, haze, ripple * 0.1), mix(accent, haze, 0.5), cast), haze, fog(depth));
      } else c = mix(haze, deep, Math.min(1, Math.sqrt(dir[1]) * 1.25));
      const at = (y * w + x) * 3;
      colour[at] = c[0];
      colour[at + 1] = c[1];
      colour[at + 2] = c[2];
    }
  }

  // Each point of the mesh: where it lands on the picture, how far away it is, and how it is lit.
  const count = mesh.positions.length / 3;
  const normals = pointNormals(mesh);
  const sx = new Float32Array(count);
  const sy = new Float32Array(count);
  const sz = new Float32Array(count);
  const world: Vec3[] = [];
  for (let i = 0; i < count; i += 1) {
    const p: Vec3 = [mesh.positions[i * 3]!, mesh.positions[i * 3 + 1]! + lift, mesh.positions[i * 3 + 2]!];
    world.push(p);
    const rel = sub(p, eye);
    const z = dot(rel, forward);
    sz[i] = z;
    sx[i] = w / 2 + (dot(rel, right) / Math.max(z, near)) * focal;
    sy[i] = h / 2 - (dot(rel, up) / Math.max(z, near)) * focal;
  }
  const key = unit([...LIGHT.key]);
  const pale = rgb(style.palette.pale);
  // Lit sides take a little of her gold. Shaded sides fall toward her deep colour. Two tones, everywhere.
  // The sums live in light.ts, which the live world's shader is generated from too.
  const tones = { deep, pale, accent };
  const lit = (index: number, material: number): Rgb => {
    const surface = surfaceOf(material);
    const base = rgb(surface.color);
    let n: Vec3 = [normals[index * 3]!, normals[index * 3 + 1]!, normals[index * 3 + 2]!];
    const toEye = unit(sub(eye, world[index]!));
    if (dot(n, toEye) < 0) n = scale(n, -1);
    return mix(herLit(base, surface.emissive, n[1], dot(n, key), dot(n, toEye), tones), haze, fog(sz[index]!));
  };

  const triangles = mesh.indices.length / 3;
  const fill = (t: number, alpha: number, write: boolean) => {
    const ia = mesh.indices[t * 3]!;
    const ib = mesh.indices[t * 3 + 1]!;
    const ic = mesh.indices[t * 3 + 2]!;
    if (sz[ia]! < near || sz[ib]! < near || sz[ic]! < near) return;
    const [ax, ay, bx, by, cx, cy] = [sx[ia]!, sy[ia]!, sx[ib]!, sy[ib]!, sx[ic]!, sy[ic]!];
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(area) < 1e-9) return;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
    const x1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx, cx)));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy)));
    const y1 = Math.min(h - 1, Math.ceil(Math.max(ay, by, cy)));
    if (x0 > x1 || y0 > y1) return;
    const material = mesh.materials[t]!;
    const [ca, cb, cc] = [lit(ia, material), lit(ib, material), lit(ic, material)];
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const px = x + 0.5;
        const py = y + 0.5;
        const wa = ((bx - px) * (cy - py) - (by - py) * (cx - px)) / area;
        const wb = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) / area;
        const wc = 1 - wa - wb;
        if (wa < 0 || wb < 0 || wc < 0) continue;
        const z = wa * sz[ia]! + wb * sz[ib]! + wc * sz[ic]!;
        const at = y * w + x;
        if (z >= depthAt[at]!) continue;
        if (write) depthAt[at] = z;
        for (let k = 0; k < 3; k += 1) {
          const value = wa * ca[k]! + wb * cb[k]! + wc * cc[k]!;
          colour[at * 3 + k] = colour[at * 3 + k]! * (1 - alpha) + value * alpha;
        }
      }
    }
  };
  const clear: number[] = [];
  for (let t = 0; t < triangles; t += 1) {
    if (surfaceOf(mesh.materials[t]!).alpha >= 1) fill(t, 1, true);
    else clear.push(t);
  }
  // See-through surfaces go on last, far ones first.
  const far = (t: number) => sz[mesh.indices[t * 3]!]! + sz[mesh.indices[t * 3 + 1]!]! + sz[mesh.indices[t * 3 + 2]!]!;
  clear.sort((a, b) => far(b) - far(a));
  for (const t of clear) fill(t, surfaceOf(mesh.materials[t]!).alpha, false);

  const surface = new Surface(W, H);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const c: Rgb = [0, 0, 0];
      for (let j = 0; j < SS; j += 1) for (let i = 0; i < SS; i += 1) for (let k = 0; k < 3; k += 1) c[k] = c[k]! + colour[((y * SS + j) * w + x * SS + i) * 3 + k]! / (SS * SS);
      surface.over(x, y, c, 1);
    }
  }
  // Small things adrift, as in the water of her portrait.
  let state = (Math.round(distance * 1000) ^ 0x7f4a7c15) >>> 0;
  const chance = () => {
    state = (Math.imul(state ^ (state >>> 15), 2246822519) + 0x9e3779b9) >>> 0;
    return state / 4294967296;
  };
  for (let k = 0; k < 70; k += 1) surface.dot(chance() * W, chance() * H * 0.62, W * (0.0012 + chance() * 0.002), pale, 0.05 + chance() * 0.1);
  // Her lights bloom a little.
  const glow = MATERIALS.indexOf("glow");
  const seen = new Set<number>();
  for (let t = 0; t < triangles; t += 1) {
    if (mesh.materials[t]! % MATERIALS.length !== glow) continue;
    const i = mesh.indices[t * 3]!;
    if (sz[i]! < near) continue;
    const x = sx[i]! / SS;
    const y = sy[i]! / SS;
    const cell = Math.round(x / 3) * 100_000 + Math.round(y / 3);
    if (seen.has(cell) || x < 0 || y < 0 || x >= W || y >= H) continue;
    seen.add(cell);
    if (sz[i]! > depthAt[Math.min(h - 1, Math.round(sy[i]!)) * w + Math.min(w - 1, Math.round(sx[i]!))]! + 0.2) continue;
    surface.dot(x, y, Math.max(2.5, (focal / SS / sz[i]!) * 0.35), accent, 0.12);
  }
  return surface;
}
