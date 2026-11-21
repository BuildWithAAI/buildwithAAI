import { deflateSync } from "node:zlib";

/**
 * Her own picture surface. A grid of colour she draws on with soft dots, and a writer that turns it
 * into a PNG file. No drawing library is used. Compression is the platform's own deflate.
 */

export type Rgb = [number, number, number];

export class Surface {
  /** Red, green, blue and coverage for each point, colour already multiplied by coverage. */
  readonly data: Float32Array;
  constructor(readonly width: number, readonly height: number) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 20_000_000) throw new Error("SURFACE_SIZE");
    this.data = new Float32Array(width * height * 4);
  }

  /** Lays a colour over one point. */
  over(x: number, y: number, color: Rgb, alpha: number): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height || alpha <= 0) return;
    const a = alpha > 1 ? 1 : alpha;
    const at = (y * this.width + x) * 4;
    const keep = 1 - a;
    this.data[at] = color[0] * a + this.data[at]! * keep;
    this.data[at + 1] = color[1] * a + this.data[at + 1]! * keep;
    this.data[at + 2] = color[2] * a + this.data[at + 2]! * keep;
    this.data[at + 3] = a + this.data[at + 3]! * keep;
  }

  /** A soft round dot, strongest at its centre and gone at its edge. */
  dot(cx: number, cy: number, radius: number, color: Rgb, alpha: number): void {
    if (radius <= 0 || alpha <= 0) return;
    const x0 = Math.max(0, Math.floor(cx - radius));
    const x1 = Math.min(this.width - 1, Math.ceil(cx + radius));
    const y0 = Math.max(0, Math.floor(cy - radius));
    const y1 = Math.min(this.height - 1, Math.ceil(cy + radius));
    const rr = radius * radius;
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        const d = (dx * dx + dy * dy) / rr;
        if (d >= 1) continue;
        const fall = (1 - d) * (1 - d);
        this.over(x, y, color, alpha * fall);
      }
    }
  }

  /** Coverage at a point, 0 to 1. */
  alphaAt(x: number, y: number): number {
    return this.data[(y * this.width + x) * 4 + 3] ?? 0;
  }
}

/** Hue in degrees, saturation and lightness 0 to 1. */
export function hsl(h: number, s: number, l: number): Rgb {
  const hue = (((h % 360) + 360) % 360) / 60;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((hue % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = hue < 1 ? [c, x, 0] : hue < 2 ? [x, c, 0] : hue < 3 ? [0, c, x] : hue < 4 ? [0, x, c] : hue < 5 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m];
}

const CRC = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = CRC[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + body.length);
  out.writeUInt32BE(body.length, 0);
  out.write(type, 4, "latin1");
  out.set(body, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
  return out;
}

/** An 8-bit RGBA PNG. Where nothing was drawn the picture is clear, so it prints on any colour. */
export function encodePng(surface: Surface): Buffer {
  const { width, height, data } = surface;
  const raw = Buffer.alloc(height * (1 + width * 4));
  let at = 0;
  for (let y = 0; y < height; y += 1) {
    raw[at] = 0;
    at += 1;
    for (let x = 0; x < width; x += 1) {
      const from = (y * width + x) * 4;
      const a = data[from + 3]!;
      const scale = a > 0 ? 255 / a : 0;
      raw[at] = Math.max(0, Math.min(255, Math.round(data[from]! * scale)));
      raw[at + 1] = Math.max(0, Math.min(255, Math.round(data[from + 1]! * scale)));
      raw[at + 2] = Math.max(0, Math.min(255, Math.round(data[from + 2]! * scale)));
      raw[at + 3] = Math.max(0, Math.min(255, Math.round(a * 255)));
      at += 4;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", new Uint8Array(0))]);
}
