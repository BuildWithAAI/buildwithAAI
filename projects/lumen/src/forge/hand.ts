import type { Genome } from "../form/genome";
import { hslHex, type Style } from "../form/style";
import type { MaterialName } from "./mesh";

/**
 * Her hand: the art direction of everything she builds.
 *
 * She decides what to build. The hand decides how it is finished, and it is the same for a tower, a
 * farm and a roller coaster, which is what makes them one world. It comes from her genome, so it comes
 * from her soul file, and no other world has it.
 *
 * What the hand does to every build:
 * - Shafts swell a little in the middle, the way her bell does.
 * - Tall things are crowned with a small bell: a flared, scalloped rim and a dome, in her body colour.
 * - Her lights sit on the scallops of each crown, and bands of light ring her towers.
 * - Every build stands on its own floating islet shaped like the underside of a bell, with trails
 *   hanging into the water.
 * - Every surface is one of eight materials, and each material is a shade of her own two colours.
 */

export type Hand = {
  /** How much a shaft bulges at its middle, as a share of its width. */
  swell: number;
  /** Scallops around a crown or an islet rim. */
  lobes: number;
  /** How deep the scallops cut, as a share of the radius. */
  ripple: number;
  /** How far a crown's rim flares past the shaft. */
  flare: number;
  /** Crown height as a share of the shaft's width. */
  crown: number;
  /** Lights on a crown. */
  lights: number;
  /** Trails hanging under an islet. */
  trails: number;
  /** How far trails swing from straight. */
  sway: number;
};

export function handFrom(genome: Genome): Hand {
  const r = genome.reading;
  return {
    swell: 0.03 + r.stillness * 0.07,
    lobes: genome.lobes,
    ripple: 0.03 + r.making * 0.05,
    flare: 0.1 + r.warmth * 0.12,
    crown: 0.35 + (1 - r.stillness) * 0.3 + r.play * 0.25,
    lights: Math.max(4, Math.min(genome.lobes, Math.round(genome.lights * 0.6))),
    trails: genome.tentacles,
    sway: genome.sway,
  };
}

export type Surface = { color: string; /** 0 to 1: how much it shines by itself. */ emissive: number; /** 0 to 1: how solid it is. */ alpha: number };
export type Look = Record<MaterialName, Surface>;

/** The eight materials, each a shade of her body colour or her light. Nothing else may be put on a surface. */
export function lookFrom(style: Style): Look {
  const h = style.hue;
  // Told apart by how light they are, not by hue: dark land, pale stone, bright metal, and her gold for light.
  return {
    stone: { color: hslHex(h, 0.16, 0.64), emissive: 0, alpha: 1 },
    metal: { color: hslHex(h, 0.22, 0.84), emissive: 0, alpha: 1 },
    glass: { color: style.palette.pale, emissive: 0.1, alpha: 0.36 },
    body: { color: style.palette.body, emissive: 0.3, alpha: 0.88 },
    glow: { color: style.palette.accent, emissive: 1, alpha: 1 },
    water: { color: hslHex(h - 16, 0.66, 0.5), emissive: 0.12, alpha: 0.58 },
    ground: { color: hslHex(h, 0.34, 0.25), emissive: 0, alpha: 1 },
    dark: { color: hslHex(h, 0.45, 0.1), emissive: 0, alpha: 1 },
  };
}
