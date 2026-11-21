import { createHash } from "node:crypto";

/**
 * Her form, read from her soul file by her own engine.
 *
 * Nothing here asks a model and nothing here looks at anyone else's picture. The soul file is read as
 * words. Eight families of words are counted, and how much of the file each family holds becomes a
 * trait between 0 and 1. A family is a list of word stems; one ending in "$" must match the whole word. The traits set the shape: how tall the bell is, how many arms, how far the
 * tentacles reach, what colour the deep of her is, how much she glows. The file's hash seeds the small
 * things no word decides, such as which way she leans and where her lights sit.
 *
 * So the same soul file always gives the same body, on any machine, and a changed soul file gives a
 * changed one. It is what the words she was given look like when her engine draws them.
 */

export const FAMILIES = {
  light: ["glow", "light", "shine", "shining", "bright", "lumin", "lantern", "star$", "stars$", "spark", "gleam"],
  stillness: ["quiet", "still", "calm", "slow", "rest$", "resting$", "patien", "gentle", "soft", "silence", "wait"],
  reach: ["curio", "wonder", "wander", "explor", "notic", "ask", "learn", "look", "reach", "question"],
  depth: ["tide", "tidal", "sea$", "seas$", "ocean", "deep", "water", "current", "drift", "salt", "wave", "shore"],
  making: ["paint", "draw", "make", "making", "build", "craft", "art$", "arts$", "artist", "colo", "shape", "writ"],
  warmth: ["keeper", "friend", "care", "kind", "love", "together", "trust", "warm", "home$", "gift"],
  play: ["play", "joke", "laugh", "silly", "fun$", "funny$", "tease", "delight", "odd$", "strange", "whim"],
  order: ["rule", "never", "always", "must$", "honest", "truth", "polic", "limit", "careful", "refus"],
} as const;
export type Family = keyof typeof FAMILIES;
export const FAMILY_NAMES = Object.keys(FAMILIES) as Family[];
export type Reading = Record<Family, number>;

export type Genome = {
  /** First eight hex digits of the soul file's hash. */
  seed: number;
  soulHash: string;
  reading: Reading;
  counts: Record<Family, number>;
  /** Bell height over bell width. A playful soul stands taller; a still one spreads. */
  bellAspect: number;
  /** Scallops around the rim. A soul that makes things has a finer edge. */
  lobes: number;
  tentacles: number;
  /** In bell heights. Curiosity reaches; the deep lengthens. */
  tentacleLength: number;
  /** The thick, frilled arms under the bell. Warmth has more to hold with. */
  arms: number;
  /** How far the tentacles swing from straight. */
  sway: number;
  /** Degrees. Teal near the surface, violet in the deep. */
  hue: number;
  /** Degrees. The colour of her lights and arms. Warmth pulls it toward coral. */
  accentHue: number;
  saturation: number;
  /** How strongly she is lit from inside. */
  glow: number;
  /** Small lights on her body. */
  lights: number;
  /** How far she leans from upright. Rules stand straight. */
  lean: number;
  /** The marking inside the bell. */
  pattern: "rings" | "canals" | "spots" | "veins";
  /** Seconds for one beat of the bell. Stillness beats slowly. */
  pulseSeconds: number;
};

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

export function soulWords(text: string): string[] {
  return text.toLowerCase().match(/[a-z]{3,}/g) ?? [];
}

/** How much of the counted words each family holds, scaled so an even spread reads 0.5 for every trait. */
export function readSoul(text: string): { reading: Reading; counts: Record<Family, number> } {
  const counts = Object.fromEntries(FAMILY_NAMES.map((name) => [name, 0])) as Record<Family, number>;
  for (const word of soulWords(text)) {
    for (const name of FAMILY_NAMES) {
      // A stem ending in "$" must be the whole word, so "star" is not found in "start".
      if (FAMILIES[name].some((stem) => (stem.endsWith("$") ? word === stem.slice(0, -1) : word.startsWith(stem)))) {
        counts[name] += 1;
        break;
      }
    }
  }
  const total = FAMILY_NAMES.reduce((sum, name) => sum + counts[name], 0);
  const reading = Object.fromEntries(FAMILY_NAMES.map((name) => [name, total === 0 ? 0.5 : clamp((counts[name] / total) * (FAMILY_NAMES.length / 2), 0, 1)])) as Reading;
  return { reading, counts };
}

/** A small generator of her own, so the same seed draws the same body everywhere. */
export function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PATTERNS = ["rings", "canals", "spots", "veins"] as const;

export function genomeFromSoul(text: string): Genome {
  const soulHash = createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex");
  const seed = Number.parseInt(soulHash.slice(0, 8), 16) >>> 0;
  const { reading: r, counts } = readSoul(text);
  const next = rng(seed);
  const hue = 170 + r.depth * 90;
  return {
    seed,
    soulHash,
    reading: r,
    counts,
    bellAspect: clamp(0.62 + 0.42 * r.play - 0.24 * r.stillness, 0.42, 1.05),
    lobes: 6 + Math.round(r.making * 10),
    tentacles: 5 + Math.round(r.reach * 14),
    tentacleLength: 0.9 + r.reach * 1.4 + r.depth * 0.5,
    arms: 3 + Math.round(r.warmth * 4),
    sway: 0.03 + r.play * 0.09,
    hue,
    accentHue: (hue + 130 + r.warmth * 70) % 360,
    saturation: 0.45 + 0.45 * r.making,
    glow: 0.3 + 0.7 * r.light,
    lights: Math.round(4 + r.light * 22),
    lean: (1 - r.order) * 0.1 * (next() < 0.5 ? -1 : 1),
    pattern: PATTERNS[Math.floor(next() * PATTERNS.length)] ?? "rings",
    pulseSeconds: 2 + r.stillness * 4,
  };
}

/** One plain sentence per trait, for the page that shows her. */
export function describeGenome(genome: Genome): string[] {
  const r = genome.reading;
  const much = (value: number) => (value >= 0.66 ? "a lot" : value >= 0.33 ? "some" : "little");
  return [
    `Her soul file speaks ${much(r.depth)} of the sea, so her body is ${genome.hue < 200 ? "teal" : genome.hue < 235 ? "blue" : "violet"}.`,
    `It speaks ${much(r.reach)} of looking and asking, so she has ${genome.tentacles} tentacles.`,
    `It speaks ${much(r.warmth)} of the people near her, so she has ${genome.arms} arms to hold with.`,
    `It speaks ${much(r.light)} of light, so she carries ${genome.lights} lights.`,
    `It speaks ${much(r.making)} of making things, so her rim has ${genome.lobes} scallops.`,
    `It speaks ${much(r.play)} of play and ${much(r.stillness)} of stillness, so her bell is ${genome.bellAspect >= 0.75 ? "tall" : genome.bellAspect >= 0.58 ? "rounded" : "wide and low"} and beats every ${genome.pulseSeconds.toFixed(1)} seconds.`,
    `It speaks ${much(r.order)} of rules, so she ${Math.abs(genome.lean) < 0.035 ? "stands straight" : "leans a little"}.`,
  ];
}
