import { rng, type Genome } from "./genome";
import { encodePng, Surface, type Rgb } from "./raster";
import { houseStyle, hslHex, type Style } from "./style";

/**
 * Draws her from her genome. Every mark is worked out here from numbers: a dome, a scalloped rim, the
 * marking inside, lights, arms and tentacles. Nothing is copied from a picture. Her colours are the
 * house style's colours, the same ones the site and her land use.
 */

function rgb(hex: string): Rgb {
  return [Number.parseInt(hex.slice(1, 3), 16) / 255, Number.parseInt(hex.slice(3, 5), 16) / 255, Number.parseInt(hex.slice(5, 7), 16) / 255];
}

export type PortraitOptions = { width: number; background: "water" | "clear" };

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function smooth(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function drawPortrait(genome: Genome, options: PortraitOptions, style: Style = houseStyle(genome)): Surface {
  const W = options.width;
  const H = Math.round(W * 1.25);
  const surface = new Surface(W, H);
  const next = rng(genome.seed ^ 0x9e3779b9);
  const body = rgb(style.palette.body);
  const pale = rgb(style.palette.pale);
  const accent = rgb(style.palette.accent);

  if (options.background === "water") {
    const top = rgb(style.palette.pool);
    const bottom = rgb(hslHex(style.hue + 20, 0.55, 0.03));
    for (let y = 0; y < H; y += 1) {
      const shade = mix(top, bottom, y / (H - 1));
      for (let x = 0; x < W; x += 1) surface.over(x, y, shade, 1);
    }
    // Small things adrift in the water.
    for (let i = 0; i < 90; i += 1) surface.dot(next() * W, next() * H, W * (0.0015 + next() * 0.003), pale, 0.05 + next() * 0.12);
  }

  const cx = W * 0.5;
  const rx = W * 0.27;
  const ry = rx * genome.bellAspect;
  const skirt = 0.24;
  // Tentacle length follows the bell's width, and she is placed so that all of her sits in the middle of the frame.
  const bellHeight = ry * (1 + skirt * 0.6);
  const length = Math.min(genome.tentacleLength * rx * 1.25, H * 0.88 - bellHeight);
  const cy = (H - (bellHeight + length * 0.9)) / 2 + ry;
  const rimDepth = (u: number) => skirt + 0.07 * Math.cos(genome.lobes * Math.PI * u);

  // Tentacles and arms are drawn first, so the bell sits in front of where they join it.
  const start = cy + ry * skirt * 0.6;
  for (let i = 0; i < genome.tentacles; i += 1) {
    const u = genome.tentacles === 1 ? 0 : -0.86 + (1.72 * i) / (genome.tentacles - 1);
    const x0 = cx + u * rx + genome.lean * rx * skirt;
    const reach = length * (0.7 + next() * 0.3);
    const phase = next() * Math.PI * 2;
    const waves = 1.2 + next() * 1.8;
    const pull = (next() - 0.5) * 0.12 * W + genome.lean * W * 0.5;
    const steps = Math.ceil(reach / Math.max(1, W * 0.0018));
    for (let s = 0; s <= steps; s += 1) {
      const t = s / steps;
      const x = x0 + Math.sin(t * waves * Math.PI * 2 + phase) * genome.sway * W * t + pull * t * t;
      surface.dot(x, start + t * reach, W * (0.0052 - 0.0034 * t), mix(pale, body, t), 0.5 * Math.pow(1 - t, 0.6) + 0.04);
    }
  }
  for (let i = 0; i < genome.arms; i += 1) {
    const u = genome.arms === 1 ? 0 : -0.36 + (0.72 * i) / (genome.arms - 1);
    const reach = length * (0.42 + next() * 0.2);
    const phase = next() * Math.PI * 2;
    const steps = Math.ceil(reach / Math.max(1, W * 0.004));
    for (let s = 0; s <= steps; s += 1) {
      const t = s / steps;
      const frill = 1 + 0.45 * Math.sin(t * 26 + phase);
      const x = cx + u * rx + Math.sin(t * 5 + phase) * genome.sway * W * 0.7 * t + genome.lean * W * 0.3 * t;
      surface.dot(x, start + t * reach, W * 0.017 * frill * (1 - 0.55 * t), mix(accent, body, t * 0.6), 0.2 * (1 - t * 0.7));
    }
  }

  // The bell. Each point is asked how deep inside the shape it is.
  const spots: { u: number; v: number; r: number }[] = [];
  for (let i = 0; i < 9; i += 1) spots.push({ u: (next() - 0.5) * 1.3, v: -0.15 - next() * 0.6, r: 0.07 + next() * 0.09 });
  const veinShift = next() * 6;
  const edge = Math.max(0.012, 2.5 / rx);
  for (let y = Math.max(0, Math.floor(cy - ry - 2)); y <= Math.min(H - 1, Math.ceil(cy + ry * 0.4)); y += 1) {
    for (let x = Math.max(0, Math.floor(cx - rx * 1.2)); x <= Math.min(W - 1, Math.ceil(cx + rx * 1.2)); x += 1) {
      const v = (y + 0.5 - cy) / ry;
      const u = (x + 0.5 - cx) / rx - genome.lean * v;
      if (Math.abs(u) >= 1) continue;
      const k = v <= 0 ? 1 : rimDepth(u);
      const d = 1 - Math.sqrt(u * u + (v / k) * (v / k));
      if (d <= 0) continue;
      const inside = smooth(0, edge, d);
      // A clear body: thin in the middle, bright where its edge turns toward the eye.
      const rim = Math.pow(1 - Math.min(1, d), 3);
      let color = mix(body, pale, rim * 0.8);
      let alpha = 0.3 + 0.55 * rim;
      const radius = Math.sqrt(u * u + (v + 1) * (v + 1) * 0.5);
      const angle = Math.atan2(v + 1.05, u);
      let mark = 0;
      if (genome.pattern === "rings") mark = Math.pow(Math.abs(Math.sin(radius * 9)), 10);
      else if (genome.pattern === "canals") mark = Math.pow(Math.abs(Math.sin(angle * genome.lobes)), 18) * smooth(0.15, 0.5, radius);
      else if (genome.pattern === "veins") mark = Math.pow(Math.abs(Math.sin(angle * genome.lobes * 0.5 + Math.sin(radius * 7 + veinShift) * 0.6)), 14) * smooth(0.1, 0.5, radius);
      else for (const spot of spots) mark = Math.max(mark, 1 - smooth(0, spot.r, Math.hypot(u - spot.u, v - spot.v)));
      color = mix(color, accent, mark * 0.55);
      alpha += mark * 0.18;
      // Lit from inside, low in the bell.
      const lamp = Math.exp(-((u * u) / 0.16 + ((v + 0.12) * (v + 0.12)) / 0.1)) * genome.glow;
      color = mix(color, mix(accent, [1, 1, 1], 0.45), Math.min(0.85, lamp * 0.7));
      alpha += lamp * 0.3;
      surface.over(x, y, color, Math.min(0.97, alpha) * inside);
    }
  }

  // Her lights: along the rim and scattered in the bell.
  for (let i = 0; i < genome.lights; i += 1) {
    const onRim = i % 2 === 0;
    const u = (next() - 0.5) * (onRim ? 1.8 : 1.2);
    const v = onRim ? rimDepth(u) * Math.sqrt(Math.max(0, 1 - u * u)) * 0.85 : -0.1 - next() * 0.6 * Math.sqrt(Math.max(0, 1 - u * u));
    const x = cx + (u + genome.lean * v) * rx;
    const y = cy + v * ry;
    surface.dot(x, y, W * 0.016, accent, 0.22 * genome.glow);
    surface.dot(x, y, W * 0.005, [1, 1, 1], 0.75 * genome.glow);
  }
  return surface;
}

export function portraitPng(genome: Genome, options: PortraitOptions): Buffer {
  return encodePng(drawPortrait(genome, options));
}
