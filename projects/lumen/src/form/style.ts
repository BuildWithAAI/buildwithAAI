import type { Genome } from "./genome";

/**
 * The one style. Everything the engine draws takes its colours and its hand from here: her portrait,
 * her art, her glow, the site, and each part of her land.
 *
 * The style comes from her genome, so it comes from her soul file. There is one of it.
 *
 * Whatever she builds, anywhere in her world, is drawn with these colours and this hand. A tower, a
 * farm and a roller coaster are different things in one world, not different worlds.
 *
 * This file reads nothing from disk, so the site's pages and the world's renderer can both use it.
 */

export type Palette = {
  /** The darkest ground: deep water, page background. */
  deep: string;
  /** A lifted ground: panels, shallows. */
  pool: string;
  /** Solid things: stone, walls, borders. */
  rock: string;
  /** Her body colour. The main colour of anything she makes. */
  body: string;
  /** The body colour toward white: highlights and thin edges. */
  pale: string;
  /** Her lights. The colour that marks a thing as hers. */
  accent: string;
  /** Text and fine lines. */
  ink: string;
  /** Quiet text. */
  dim: string;
};

export type Style = {
  hue: number;
  accentHue: number;
  saturation: number;
  glow: number;
  /** Stroke width as a share of a drawing's width. */
  line: number;
  marking: Genome["pattern"];
  palette: Palette;
};

/** The most one small piece of art may turn from her body colour, in degrees of hue. */
export const PIECE_TURN = 28;

function wrap(hue: number): number {
  return ((hue % 360) + 360) % 360;
}

export function hslHex(h: number, s: number, l: number): string {
  const hue = wrap(h) / 60;
  const sat = Math.min(1, Math.max(0, s));
  const light = Math.min(1, Math.max(0, l));
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs((hue % 2) - 1));
  const m = light - c / 2;
  const [r, g, b] = hue < 1 ? [c, x, 0] : hue < 2 ? [x, c, 0] : hue < 3 ? [0, c, x] : hue < 4 ? [0, x, c] : hue < 5 ? [x, 0, c] : [c, 0, x];
  return `#${[r, g, b].map((value) => Math.round((value + m) * 255).toString(16).padStart(2, "0")).join("")}`;
}

function build(genome: Pick<Genome, "accentHue" | "glow" | "pattern" | "reading">, hue: number, saturation: number): Style {
  const accentSat = Math.min(1, 0.6 + genome.reading.making * 0.35);
  return {
    hue,
    accentHue: genome.accentHue,
    saturation,
    glow: genome.glow,
    line: 0.006 + genome.reading.order * 0.004,
    marking: genome.pattern,
    palette: {
      deep: hslHex(hue, 0.5, 0.07),
      pool: hslHex(hue, 0.48, 0.13),
      rock: hslHex(hue, 0.22, 0.2),
      body: hslHex(hue, saturation, 0.62),
      pale: hslHex(hue, saturation * 0.6, 0.86),
      accent: hslHex(genome.accentHue, accentSat, 0.68),
      ink: hslHex(genome.accentHue, 0.3, 0.94),
      dim: hslHex(genome.accentHue, 0.12, 0.68),
    },
  };
}

export function houseStyle(genome: Genome): Style {
  return build(genome, genome.hue, genome.saturation);
}

/** Hue offsets for feelings, measured from her own body colour, so her moods are shades of her and not a fixed chart. */
const FEELING_TURN: Record<string, { hue: number; light: number; useAccent?: boolean }> = {
  calm: { hue: 0, light: 0.72 },
  curiosity: { hue: -32, light: 0.72 },
  loneliness: { hue: 14, light: 0.6 },
  worry: { hue: 34, light: 0.76 },
  boredom: { hue: 0, light: 0.58 },
  joy: { hue: 0, light: 0.74, useAccent: true },
  pride: { hue: 0, light: 0.88, useAccent: true },
  frustration: { hue: -48, light: 0.66, useAccent: true },
};

export function feelingColor(style: Style, feeling: string): string {
  const shift = FEELING_TURN[feeling] ?? FEELING_TURN.calm!;
  const base = shift.useAccent ? style.accentHue : style.hue;
  const saturation = feeling === "boredom" ? 0.14 : Math.max(0.55, style.saturation);
  return hslHex(base + shift.hue, saturation, shift.light);
}

/** The site's colours, as the variables its stylesheet already uses. */
export function cssVariables(style: Style): Record<string, string> {
  const p = style.palette;
  return { "--ink": p.ink, "--dim": p.dim, "--bg": p.deep, "--pool": p.pool, "--rock": p.rock, "--line": `${p.pale}38`, "--accent": p.accent, "--body": p.body };
}
