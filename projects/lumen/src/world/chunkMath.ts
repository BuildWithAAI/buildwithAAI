/** Shared chunk geometry. No database, no secrets, no payments. */

export const CHUNK_TILES = 32;
export const CHUNK_WORLD = 180;
export const TILE_WORLD = CHUNK_WORLD / CHUNK_TILES;
export const CHUNK_COORD_LIMIT = 4096;
export const HOME_CHUNK = { cx: 0, cy: 0 } as const;

export const TILE_KINDS = ["water", "sand", "grass", "stone", "reef", "kelp"] as const;
export type TileKind = (typeof TILE_KINDS)[number];

const TILE_CODE: Record<TileKind, string> = {
  water: "w",
  sand: "s",
  grass: "g",
  stone: "t",
  reef: "r",
  kelp: "k",
};

const CODE_TILE: Record<string, TileKind> = {
  w: "water",
  s: "sand",
  g: "grass",
  t: "stone",
  r: "reef",
  k: "kelp",
};

export const TILE_COLOR: Record<TileKind, string> = {
  water: "#1a6f86",
  sand: "#e4d0a4",
  grass: "#3e8f58",
  stone: "#8d8578",
  reef: "#c46b7a",
  kelp: "#1f6a48",
};

/** Height of a generated tile, in world units. The island mesh covers chunk 0,0. */
export const TILE_HEIGHT: Record<TileKind, number> = {
  water: -1.25,
  sand: -0.35,
  grass: 0.15,
  stone: 0.55,
  reef: -0.7,
  kelp: -0.95,
};

export type PublicDecor = {
  tx: number;
  ty: number;
  buildId: string;
  title: string;
  hue: number;
  form: number;
  size: number;
};

export type PublicChunk = {
  cx: number;
  cy: number;
  tiles: string;
  decor: PublicDecor[];
};

export const GUEST_CREATURES = ["wisp", "crab", "minnow", "lantern", "pebble"] as const;
export type GuestCreature = (typeof GUEST_CREATURES)[number];

/** A visiting agent. Never Zoora, and never a jellyfish. */
export type PublicGuest = {
  id: string;
  name: string;
  creature: GuestCreature;
  color: string;
  cx: number;
  cy: number;
  tx: number;
  ty: number;
  speech: string;
};

export function chunkKey(cx: number, cy: number): string {
  return `${cx},${cy}`;
}

export function isChunkCoord(value: number): boolean {
  return Number.isSafeInteger(value) && Math.abs(value) <= CHUNK_COORD_LIMIT;
}

export function parseChunkQuery(x: string | null, y: string | null): { cx: number; cy: number } | null {
  if (x == null || y == null || !/^-?\d+$/.test(x) || !/^-?\d+$/.test(y)) return null;
  const cx = Number(x);
  const cy = Number(y);
  if (!isChunkCoord(cx) || !isChunkCoord(cy)) return null;
  return { cx, cy };
}

export function isTileCoord(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value < CHUNK_TILES;
}

export function packTiles(tiles: TileKind[]): string {
  let packed = "";
  for (const tile of tiles) packed += TILE_CODE[tile];
  return packed;
}

export function unpackTiles(packed: string): TileKind[] | null {
  if (packed.length !== CHUNK_TILES * CHUNK_TILES) return null;
  const tiles: TileKind[] = [];
  for (const code of packed) {
    const kind = CODE_TILE[code];
    if (!kind) return null;
    tiles.push(kind);
  }
  return tiles;
}

export function tileIndex(tx: number, ty: number): number {
  return ty * CHUNK_TILES + tx;
}

/** Chunk 0,0 is centered on the island. Its west edge is x = -90. */
export function chunkOrigin(cx: number, cy: number): { x: number; z: number } {
  return {
    x: cx * CHUNK_WORLD - CHUNK_WORLD / 2,
    z: cy * CHUNK_WORLD - CHUNK_WORLD / 2,
  };
}

export function tileWorld(cx: number, cy: number, tx: number, ty: number): { x: number; z: number } {
  const origin = chunkOrigin(cx, cy);
  return {
    x: origin.x + (tx + 0.5) * TILE_WORLD,
    z: origin.z + (ty + 0.5) * TILE_WORLD,
  };
}

export function worldToChunk(x: number, z: number): { cx: number; cy: number; tx: number; ty: number } {
  const cx = Math.floor((x + CHUNK_WORLD / 2) / CHUNK_WORLD);
  const cy = Math.floor((z + CHUNK_WORLD / 2) / CHUNK_WORLD);
  const origin = chunkOrigin(cx, cy);
  let tx = Math.floor((x - origin.x) / TILE_WORLD);
  let ty = Math.floor((z - origin.z) / TILE_WORLD);
  if (tx < 0) tx = 0;
  if (ty < 0) ty = 0;
  if (tx >= CHUNK_TILES) tx = CHUNK_TILES - 1;
  if (ty >= CHUNK_TILES) ty = CHUNK_TILES - 1;
  return { cx, cy, tx, ty };
}

export function chunkDistance(a: { cx: number; cy: number }, b: { cx: number; cy: number }): number {
  return Math.max(Math.abs(a.cx - b.cx), Math.abs(a.cy - b.cy));
}

/** Chunks around the camera that are not loaded yet. Chunk 0,0 is the island and is still listed. */
export function chunksToLoad(
  loaded: ReadonlySet<string>,
  cx: number,
  cy: number,
  radius = 1,
): { cx: number; cy: number }[] {
  const need: { cx: number; cy: number }[] = [];
  for (let y = cy - radius; y <= cy + radius; y += 1) {
    for (let x = cx - radius; x <= cx + radius; x += 1) {
      if (!isChunkCoord(x) || !isChunkCoord(y)) continue;
      if (loaded.has(chunkKey(x, y))) continue;
      need.push({ cx: x, cy: y });
    }
  }
  return need;
}
