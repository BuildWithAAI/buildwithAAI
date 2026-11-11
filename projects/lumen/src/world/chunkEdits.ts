import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { isChunkCoord, isTileCoord, type PublicDecor } from "./chunkMath";

export const CHUNK_EDIT_KINDS = ["decor", "decor-rollback"] as const;
export type ChunkEditKind = (typeof CHUNK_EDIT_KINDS)[number];

export type ChunkEditInput = {
  id: string;
  atMs: number;
  chunkX: number;
  chunkY: number;
  tileX: number;
  tileY: number;
  kind: ChunkEditKind;
  payload: unknown;
  actor: string;
  idempotencyKey: string;
};

export type ChunkEditRow = {
  seq: number;
  id: string;
  atMs: number;
  chunkX: number;
  chunkY: number;
  tileX: number;
  tileY: number;
  kind: ChunkEditKind;
  payload: string;
  actor: string;
  idempotencyKey: string;
  prevHash: string;
  bodyHash: string;
  entryHash: string;
};

const PAYLOAD_KEYS = ["buildId", "version", "title", "hue", "parts", "twist", "form", "size"] as const;

/** Sort object keys so the hash does not depend on insertion order. */
export function canonical(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) out[key] = sortValue((value as Record<string, unknown>)[key]);
    return out;
  }
  return value;
}

function finite(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < min || value > max) return null;
  return value;
}

/**
 * Decor is numbers and a short title. No scripts, routes, or addresses.
 * A visitor cannot pass this check because the actor is refused first.
 */
export function sandboxDecorPayload(payload: unknown): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("SANDBOX");
  const raw = payload as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (!(PAYLOAD_KEYS as readonly string[]).includes(key)) throw new Error("SANDBOX");
  }
  const buildId = raw.buildId;
  const title = raw.title;
  const version = raw.version;
  if (typeof buildId !== "string" || !/^build-[a-z0-9-]{4,40}$/.test(buildId)) throw new Error("SANDBOX");
  if (typeof title !== "string" || title.length < 1 || title.length > 60) throw new Error("SANDBOX");
  if (/<\s*script|https?:\/\//i.test(title)) throw new Error("SANDBOX");
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1 || version > 10_000) throw new Error("SANDBOX");
  const hue = finite(raw.hue, 0, 360);
  const parts = finite(raw.parts, 1, 12);
  const twist = finite(raw.twist, 0, 1);
  const form = finite(raw.form, 0, 8);
  const size = finite(raw.size, 0.2, 2);
  if (hue == null || parts == null || twist == null || form == null || size == null) throw new Error("SANDBOX");
  return canonical({ buildId, version, title, hue, parts, twist, form, size });
}

export function chunkEditBodyHash(input: {
  chunkX: number;
  chunkY: number;
  tileX: number;
  tileY: number;
  kind: string;
  payload: string;
  actor: string;
}): string {
  return createHash("sha256").update(canonical({
    chunkX: input.chunkX,
    chunkY: input.chunkY,
    tileX: input.tileX,
    tileY: input.tileY,
    kind: input.kind,
    payload: input.payload,
    actor: input.actor,
  })).digest("hex");
}

function assertInput(input: ChunkEditInput): string {
  if (!CHUNK_EDIT_KINDS.includes(input.kind)) throw new Error("EDIT_KIND");
  if (input.actor !== "zoora") throw new Error("ACTOR");
  if (!isChunkCoord(input.chunkX) || !isChunkCoord(input.chunkY)) throw new Error("CHUNK");
  if (!isTileCoord(input.tileX) || !isTileCoord(input.tileY)) throw new Error("TILE");
  if (!input.id || !input.idempotencyKey) throw new Error("EDIT_ID");
  return sandboxDecorPayload(input.payload);
}

export function appendChunkEdit(db: DatabaseSync, input: ChunkEditInput): ChunkEditRow {
  const payload = assertInput(input);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return appendOnce(db, input, payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt < 4 && /busy|locked|UNIQUE constraint failed: chunk_edits\.prev_hash/i.test(message)) continue;
      throw error;
    }
  }
  throw new Error("EDIT_BUSY");
}

function appendOnce(db: DatabaseSync, input: ChunkEditInput, payload: string): ChunkEditRow {
  let owns = false;
  try {
    db.exec("BEGIN IMMEDIATE");
    owns = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/within a transaction/i.test(message)) throw error;
  }
  try {
    const hash = chunkEditBodyHash({ ...input, payload });
    const existing = db.prepare("SELECT * FROM chunk_edits WHERE idempotency_key = ?").get(input.idempotencyKey) as Record<string, unknown> | undefined;
    if (existing) {
      if (existing.body_hash !== hash) throw new Error("IDEMPOTENCY_CONFLICT");
      if (owns) db.exec("COMMIT");
      return mapEdit(existing);
    }
    const prev = db.prepare("SELECT entry_hash FROM chunk_edits ORDER BY seq DESC LIMIT 1").get() as { entry_hash: string } | undefined;
    const prevHash = prev?.entry_hash ?? "GENESIS";
    const entryHash = createHash("sha256").update(prevHash + hash).digest("hex");
    db.prepare(
      `INSERT INTO chunk_edits
        (id, at_ms, chunk_x, chunk_y, tile_x, tile_y, kind, payload, actor, idempotency_key, prev_hash, body_hash, entry_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.id,
      input.atMs,
      input.chunkX,
      input.chunkY,
      input.tileX,
      input.tileY,
      input.kind,
      payload,
      input.actor,
      input.idempotencyKey,
      prevHash,
      hash,
      entryHash,
    );
    const row = db.prepare("SELECT * FROM chunk_edits WHERE id = ?").get(input.id) as Record<string, unknown>;
    if (owns) db.exec("COMMIT");
    return mapEdit(row);
  } catch (error) {
    if (owns) {
      try { db.exec("ROLLBACK"); } catch { /* already closed */ }
    }
    throw error;
  }
}

export function listChunkEdits(db: DatabaseSync): ChunkEditRow[] {
  return (db.prepare("SELECT * FROM chunk_edits ORDER BY seq ASC").all() as Record<string, unknown>[]).map(mapEdit);
}

export function verifyChunkChain(db: DatabaseSync): boolean {
  let prev = "GENESIS";
  for (const row of listChunkEdits(db)) {
    const hash = chunkEditBodyHash(row);
    if (hash !== row.bodyHash || row.prevHash !== prev) return false;
    const entry = createHash("sha256").update(prev + hash).digest("hex");
    if (entry !== row.entryHash) return false;
    prev = entry;
  }
  return true;
}

/** Latest decor on a chunk. A rollback drops that build. Generated tiles are not stored here. */
export function decorOnChunk(db: DatabaseSync, cx: number, cy: number): PublicDecor[] {
  const rows = db.prepare(
    "SELECT kind, payload, tile_x, tile_y FROM chunk_edits WHERE chunk_x = ? AND chunk_y = ? ORDER BY seq ASC",
  ).all(cx, cy) as { kind: string; payload: string; tile_x: number; tile_y: number }[];
  const live = new Map<string, PublicDecor>();
  for (const row of rows) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(row.payload) as Record<string, unknown>;
    } catch {
      continue;
    }
    const buildId = typeof parsed.buildId === "string" ? parsed.buildId : "";
    if (!buildId) continue;
    if (row.kind === "decor-rollback") {
      live.delete(buildId);
      continue;
    }
    if (row.kind !== "decor") continue;
    live.set(buildId, {
      tx: row.tile_x,
      ty: row.tile_y,
      buildId,
      title: typeof parsed.title === "string" ? parsed.title : "",
      hue: Number(parsed.hue) || 0,
      form: Number(parsed.form) || 0,
      size: Number(parsed.size) || 1,
    });
  }
  return [...live.values()];
}

function mapEdit(row: Record<string, unknown>): ChunkEditRow {
  return {
    seq: Number(row.seq),
    id: String(row.id),
    atMs: Number(row.at_ms),
    chunkX: Number(row.chunk_x),
    chunkY: Number(row.chunk_y),
    tileX: Number(row.tile_x),
    tileY: Number(row.tile_y),
    kind: row.kind as ChunkEditKind,
    payload: String(row.payload),
    actor: String(row.actor),
    idempotencyKey: String(row.idempotency_key),
    prevHash: String(row.prev_hash),
    bodyHash: String(row.body_hash),
    entryHash: String(row.entry_hash),
  };
}

export function decorPayload(build: {
  id: string;
  version: number;
  title: string;
  params: { hue: number; parts: number; twist: number; form: number; size: number };
}): Record<string, unknown> {
  return {
    buildId: build.id,
    version: build.version,
    title: build.title.slice(0, 60),
    hue: build.params.hue,
    parts: build.params.parts,
    twist: build.params.twist,
    form: build.params.form,
    size: build.params.size,
  };
}
