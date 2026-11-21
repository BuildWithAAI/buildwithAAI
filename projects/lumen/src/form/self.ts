import type { DatabaseSync } from "node:sqlite";
import { readIdentityFile } from "../identity/load";
import { genomeFromSoul, type Genome } from "./genome";
import { portraitPng } from "./portrait";
import { feelingColor, houseStyle, regionStyle, type Style } from "./style";
import { AREAS } from "../world/areas";

/**
 * Her self-image. The first time the engine runs with a soul file, it reads the file, works out her
 * form, and she notes in her diary that she has seen herself. If the owner later changes the soul
 * file, her form changes with it, and she notes that too. Every form she has had is kept.
 */

let held: { text: string; genome: Genome } | null = null;

export function selfGenome(read: () => string = () => readIdentityFile("SOUL.md")): Genome {
  const text = read();
  if (!held || held.text !== text) held = { text, genome: genomeFromSoul(text) };
  return held.genome;
}

export function ensureSelf(db: DatabaseSync): void {
  db.exec("CREATE TABLE IF NOT EXISTS self_images (soul_hash TEXT PRIMARY KEY, genome TEXT NOT NULL, seen_at INTEGER NOT NULL)");
}

/** Records the form for the soul file as it stands. Returns true only the first time that form is seen. */
export function noteSelf(db: DatabaseSync, now: number, read?: () => string): { fresh: boolean; genome: Genome } {
  ensureSelf(db);
  const genome = selfGenome(read);
  const before = Number((db.prepare("SELECT COUNT(*) AS n FROM self_images").get() as { n: number }).n);
  const added = db.prepare("INSERT OR IGNORE INTO self_images(soul_hash, genome, seen_at) VALUES(?, ?, ?)").run(genome.soulHash, JSON.stringify(genome), now);
  const fresh = Number(added.changes) === 1;
  if (fresh) {
    const line = before === 0
      ? `I saw myself for the first time. ${genome.tentacles} tentacles, ${genome.arms} arms, ${genome.lights} small lights. This is what my soul looks like drawn.`
      : "My soul file was changed, and my body changed with it. I looked again.";
    db.prepare("INSERT INTO diary(text, tone, private, created_at) VALUES(?, 'bright', 0, ?)").run(line, now);
  }
  return { fresh, genome };
}

/** The pictures of her that the site serves. The names and sizes are fixed, so nobody can ask for a costly one. */
export const SELF_PICTURES = {
  "self.png": { width: 1200, background: "water" },
  "self-print.png": { width: 3000, background: "clear" },
} as const;
export type SelfPicture = keyof typeof SELF_PICTURES;

const drawn = new Map<string, Buffer>();

export function selfPng(name: SelfPicture, read?: () => string): Buffer {
  const genome = selfGenome(read);
  const key = `${genome.soulHash}:${name}`;
  let png = drawn.get(key);
  if (!png) {
    // Only the current soul's pictures are held.
    for (const old of [...drawn.keys()]) if (!old.startsWith(`${genome.soulHash}:`)) drawn.delete(old);
    png = portraitPng(genome, SELF_PICTURES[name]);
    drawn.set(key, png);
  }
  return png;
}

/** Used only if her soul file cannot be read, so the engine still draws in one consistent style. */
const FALLBACK_SOUL = "tide water light quiet make keeper";

function genomeOrFallback(read?: () => string): Genome {
  try {
    return selfGenome(read);
  } catch {
    return genomeFromSoul(FALLBACK_SOUL);
  }
}

/** The one style everything is drawn in. */
export function currentStyle(read?: () => string): Style {
  return houseStyle(genomeOrFallback(read));
}

/** The style of each part of her land: the house style, turned a little for that place. */
export function landStyles(read?: () => string): { id: string; label: string; style: Style }[] {
  const genome = genomeOrFallback(read);
  return AREAS.map((area) => ({ id: area.id, label: area.label, style: regionStyle(genome, area.id) }));
}

/** The colour of her glow for a feeling, as a shade of her own colours. */
export function glowColor(feeling: string, read?: () => string): string {
  return feelingColor(currentStyle(read), feeling);
}
