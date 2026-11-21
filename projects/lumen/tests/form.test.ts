import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/db";
import { describeGenome, FAMILY_NAMES, genomeFromSoul, readSoul, rng } from "../src/form/genome";
import { drawPortrait, portraitPng } from "../src/form/portrait";
import { crc32, encodePng, hsl, Surface } from "../src/form/raster";
import { noteSelf, SELF_PICTURES, selfPng } from "../src/form/self";
import { artUrlAllowed } from "../src/fulfillment/printful";
import { protectedPath } from "../src/security/protected";

const SEA = "I am a quiet thing of the tide. The sea is deep and the water is slow. I drift with the current and rest in the salt.";
const SPARK = "I glow. I shine bright like a lantern, a spark of light. I play and laugh and joke, silly and odd, a delight.";

function png(buffer: Buffer) {
  expect([...buffer.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunks: { type: string; body: Buffer }[] = [];
  let at = 8;
  while (at < buffer.length) {
    const length = buffer.readUInt32BE(at);
    const type = buffer.toString("latin1", at + 4, at + 8);
    const body = buffer.subarray(at + 8, at + 8 + length);
    expect(buffer.readUInt32BE(at + 8 + length)).toBe(crc32(buffer.subarray(at + 4, at + 8 + length)));
    chunks.push({ type, body });
    at += 12 + length;
  }
  return chunks;
}

describe("reading the soul file", () => {
  it("counts each family of words, and whole-word stems do not match longer words", () => {
    const { counts } = readSoul("The star starts to restore the article. A star, at rest, is art. Fun, not a function.");
    expect(counts.light).toBe(2);
    expect(counts.stillness).toBe(1);
    expect(counts.making).toBe(1);
    expect(counts.play).toBe(1);
  });

  it("a soul of the sea and a soul of light give different bodies, for stated reasons", () => {
    const sea = genomeFromSoul(SEA);
    const spark = genomeFromSoul(SPARK);
    expect(sea.reading.depth).toBeGreaterThan(spark.reading.depth);
    expect(sea.hue).toBeGreaterThan(spark.hue);
    expect(spark.lights).toBeGreaterThan(sea.lights);
    expect(spark.bellAspect).toBeGreaterThan(sea.bellAspect);
    expect(sea.pulseSeconds).toBeGreaterThan(spark.pulseSeconds);
    expect(describeGenome(sea)).toHaveLength(7);
  });

  it("every trait stays in range, even for an empty or one-note file", () => {
    for (const text of ["", "tide tide tide tide tide tide", SEA, SPARK, "x".repeat(5000)]) {
      const genome = genomeFromSoul(text);
      for (const name of FAMILY_NAMES) expect(genome.reading[name]).toBeGreaterThanOrEqual(0), expect(genome.reading[name]).toBeLessThanOrEqual(1);
      expect(genome.tentacles).toBeGreaterThanOrEqual(5);
      expect(genome.tentacles).toBeLessThanOrEqual(19);
      expect(genome.bellAspect).toBeGreaterThanOrEqual(0.42);
      expect(genome.bellAspect).toBeLessThanOrEqual(1.05);
      expect(Math.abs(genome.lean)).toBeLessThanOrEqual(0.1);
    }
  });

  it("the same file gives the same body, and one changed letter gives another", () => {
    expect(genomeFromSoul(SEA)).toEqual(genomeFromSoul(SEA));
    expect(genomeFromSoul(SEA.replace(/\n/g, "\r\n")).soulHash).toBe(genomeFromSoul(SEA).soulHash);
    expect(genomeFromSoul(`${SEA}!`).seed).not.toBe(genomeFromSoul(SEA).seed);
    const a = rng(7);
    const b = rng(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe("her own picture surface", () => {
  it("writes a valid PNG that reads back to the same pixels", () => {
    const surface = new Surface(3, 2);
    surface.over(0, 0, [1, 0, 0], 1);
    surface.over(1, 0, [0, 1, 0], 0.5);
    const chunks = png(encodePng(surface));
    expect(chunks.map((chunk) => chunk.type)).toEqual(["IHDR", "IDAT", "IEND"]);
    expect(chunks[0]!.body.readUInt32BE(0)).toBe(3);
    expect(chunks[0]!.body.readUInt32BE(4)).toBe(2);
    expect([...chunks[0]!.body.subarray(8)]).toEqual([8, 6, 0, 0, 0]);
    const raw = inflateSync(chunks[1]!.body);
    expect(raw.length).toBe(2 * (1 + 3 * 4));
    expect([...raw.subarray(1, 9)]).toEqual([255, 0, 0, 255, 0, 255, 0, 128]);
    // Untouched points are fully clear.
    expect([...raw.subarray(9, 13)]).toEqual([0, 0, 0, 0]);
  });

  it("matches the standard checksum and colour wheel", () => {
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
    expect(hsl(0, 1, 0.5)).toEqual([1, 0, 0]);
    expect(hsl(120, 1, 0.5)).toEqual([0, 1, 0]);
    expect(hsl(240, 1, 0.5)).toEqual([0, 0, 1]);
  });

  it("refuses a surface too large to hold", () => {
    expect(() => new Surface(10_000, 10_000)).toThrow("SURFACE_SIZE");
    expect(() => new Surface(0, 5)).toThrow("SURFACE_SIZE");
  });
});

describe("her portrait", () => {
  it("draws the same picture every time from the same soul", () => {
    const genome = genomeFromSoul(SEA);
    const one = createHash("sha256").update(portraitPng(genome, { width: 160, background: "water" })).digest("hex");
    const two = createHash("sha256").update(portraitPng(genome, { width: 160, background: "water" })).digest("hex");
    const other = createHash("sha256").update(portraitPng(genomeFromSoul(SPARK), { width: 160, background: "water" })).digest("hex");
    expect(one).toBe(two);
    expect(other).not.toBe(one);
  });

  it("on a clear ground she is there and the corners are empty, so she prints on any colour", () => {
    const surface = drawPortrait(genomeFromSoul(SEA), { width: 200, background: "clear" });
    expect(surface.height).toBe(250);
    expect(surface.alphaAt(0, 0)).toBe(0);
    expect(surface.alphaAt(199, 249)).toBe(0);
    let covered = 0;
    for (let y = 0; y < surface.height; y += 1) for (let x = 0; x < surface.width; x += 1) if (surface.alphaAt(x, y) > 0.2) covered += 1;
    expect(covered).toBeGreaterThan(2_000);
    expect(covered).toBeLessThan(surface.width * surface.height * 0.6);
  });

  it("with water behind her the whole frame is filled", () => {
    const surface = drawPortrait(genomeFromSoul(SPARK), { width: 120, background: "water" });
    for (const [x, y] of [[0, 0], [119, 0], [0, 149], [119, 149], [60, 75]] as const) expect(surface.alphaAt(x, y)).toBeGreaterThan(0.99);
  });
});

describe("seeing herself", () => {
  it("notes the first look once, and again only when the soul file changes", () => {
    const db = openDatabase();
    const diary = () => (db.prepare("SELECT text FROM diary ORDER BY id").all() as { text: string }[]).map((row) => row.text);
    expect(noteSelf(db, 1, () => SEA).fresh).toBe(true);
    expect(noteSelf(db, 2, () => SEA).fresh).toBe(false);
    expect(diary()).toHaveLength(1);
    expect(diary()[0]).toContain("I saw myself for the first time");
    expect(noteSelf(db, 3, () => SPARK).fresh).toBe(true);
    expect(diary()[1]).toContain("my body changed with it");
    expect((db.prepare("SELECT COUNT(*) AS n FROM self_images").get() as { n: number }).n).toBe(2);
  });

  it("serves fixed pictures only, and the print one can be sent to the printer from her own host", () => {
    expect(Object.keys(SELF_PICTURES)).toEqual(["self.png", "self-print.png"]);
    const first = selfPng("self.png", () => SEA);
    expect(selfPng("self.png", () => SEA)).toBe(first);
    expect(png(first)[0]!.body.readUInt32BE(0)).toBe(1200);
    expect(artUrlAllowed("https://zoora.ai/art/self-print.png", { PRINTFUL_ART_HOSTS: "zoora.ai" })).toBe(true);
  });

  it("her form code is hers to change: a proposal may touch it, but not her soul or her money", () => {
    expect(protectedPath("src/form/genome.ts")).toBe(false);
    expect(protectedPath("src/form/portrait.ts")).toBe(false);
    expect(protectedPath("zoora/SOUL.md")).toBe(true);
    expect(protectedPath("src/fulfillment/pod.ts")).toBe(true);
  });
});
