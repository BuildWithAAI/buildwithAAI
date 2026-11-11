import type { DatabaseSync } from "node:sqlite";
import { createChunkCache, worldSeed, type ChunkCache } from "./chunkCache";
import { chunkIsPrivate, decorOnChunk } from "./chunkEdits";
import { packTiles, type PublicChunk } from "./chunkMath";

/** Unvisited chunks stay out of this cache. Edits stay in SQLite, not here. */
const serverChunks: ChunkCache = createChunkCache(48);

export function chunkCacheSize(): number {
  return serverChunks.size;
}

export function publicChunk(db: DatabaseSync, cx: number, cy: number, seed = worldSeed(process.env)): PublicChunk {
  const hidden = chunkIsPrivate(db, cx, cy);
  const generated = serverChunks.read(seed, cx, cy);
  return {
    cx,
    cy,
    tiles: hidden ? "" : packTiles(generated.slice()),
    decor: hidden ? [] : decorOnChunk(db, cx, cy),
    private: hidden,
  };
}

/** The island is chunk 0,0. A radius of 1 is the island plus the eight chunks around it. */
export function neighborhood(db: DatabaseSync, cx: number, cy: number, radius: number, seed = worldSeed(process.env)): PublicChunk[] {
  const span = Math.max(0, Math.min(4, radius));
  const chunks: PublicChunk[] = [];
  for (let y = cy - span; y <= cy + span; y += 1) {
    for (let x = cx - span; x <= cx + span; x += 1) chunks.push(publicChunk(db, x, y, seed));
  }
  return chunks;
}
