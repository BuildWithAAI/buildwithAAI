import { createHash } from "node:crypto";
import { CHUNK_TILES, packTiles, type TileKind } from "./chunkMath";

export const DEFAULT_WORLD_SEED = "zoora-island-0";

const SEED_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

type SeedEnv = Record<string, string | undefined>;

/** A public seed, not a secret. Anything else falls back to the island seed. */
export function worldSeed(env: SeedEnv = process.env): string {
  const raw = (env.LUMEN_WORLD_SEED ?? "").trim();
  return SEED_PATTERN.test(raw) ? raw : DEFAULT_WORLD_SEED;
}

function mix(seed: string, cx: number, cy: number, tx: number, ty: number): number {
  const digest = createHash("sha256").update(`${seed}|${cx}|${cy}|${tx}|${ty}`).digest();
  return digest.readUInt32BE(0) / 4294967296;
}

/**
 * Deterministic tiles for one chunk. The same seed and coordinates always match.
 * Chunk 0,0 is Zoora's island: grass and sand, not open ocean.
 * Generated tiles are not written to the database.
 */
export function generateChunk(seed: string, cx: number, cy: number): TileKind[] {
  const tiles: TileKind[] = new Array(CHUNK_TILES * CHUNK_TILES);
  const home = cx === 0 && cy === 0;
  const shore = Math.abs(cx) + Math.abs(cy) === 1;
  for (let ty = 0; ty < CHUNK_TILES; ty += 1) {
    for (let tx = 0; tx < CHUNK_TILES; tx += 1) {
      const n = mix(seed, cx, cy, tx, ty);
      let kind: TileKind;
      if (home) {
        if (n < 0.62) kind = "grass";
        else if (n < 0.9) kind = "sand";
        else kind = "stone";
      } else if (n < (shore ? 0.55 : 0.72)) kind = "water";
      else if (n < 0.84) kind = "sand";
      else if (n < 0.93) kind = "kelp";
      else if (n < 0.97) kind = "reef";
      else kind = "stone";
      tiles[ty * CHUNK_TILES + tx] = kind;
    }
  }
  return tiles;
}

export type ChunkCache = {
  readonly limit: number;
  readonly size: number;
  read(seed: string, cx: number, cy: number): TileKind[];
  seen(seed: string, cx: number, cy: number): boolean;
};

/** Server-side LRU. Unvisited chunks are generated on read and dropped when the cache is full. */
export function createChunkCache(limit: number): ChunkCache {
  if (!Number.isInteger(limit) || limit < 1) throw new Error("CACHE_LIMIT");
  const map = new Map<string, TileKind[]>();
  const keyOf = (seed: string, cx: number, cy: number) => `${seed}:${cx}:${cy}`;
  return {
    limit,
    get size() {
      return map.size;
    },
    seen(seed, cx, cy) {
      return map.has(keyOf(seed, cx, cy));
    },
    read(seed, cx, cy) {
      const key = keyOf(seed, cx, cy);
      const hit = map.get(key);
      if (hit) {
        map.delete(key);
        map.set(key, hit);
        return hit;
      }
      const tiles = generateChunk(seed, cx, cy);
      map.set(key, tiles);
      while (map.size > limit) {
        const oldest = map.keys().next().value;
        if (oldest === undefined) break;
        map.delete(oldest);
      }
      return tiles;
    },
  };
}

export function packedChunk(seed: string, cx: number, cy: number): string {
  return packTiles(generateChunk(seed, cx, cy));
}
