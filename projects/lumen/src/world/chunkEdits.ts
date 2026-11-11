import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { flag } from "../db/db";
import { isChunkCoord, isTileCoord, type PublicDecor } from "./chunkMath";
import { CLAIM_GROW_PER_DAY, CLAIM_START_RADIUS, zoneAt } from "./territoryRules";

export const CHUNK_EDIT_KINDS = ["decor", "decor-rollback", "privacy", "expand"] as const;
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
  id: string;
  atMs: number;
  idempotencyKey: string;
  chunkX: number;
  chunkY: number;
  tileX: number;
  tileY: number;
  kind: string;
  payload: string;
  actor: string;
}): string {
  return createHash("sha256").update(canonical({
    id: input.id,
    atMs: input.atMs,
    idempotencyKey: input.idempotencyKey,
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
  if (!isChunkCoord(input.chunkX) || !isChunkCoord(input.chunkY)) throw new Error("CHUNK");
  if (!isTileCoord(input.tileX) || !isTileCoord(input.tileY)) throw new Error("TILE");
  if (!input.id || !input.idempotencyKey) throw new Error("EDIT_ID");
  if (input.kind === "expand") return sandboxExpandPayload(input.payload);
  if (input.kind === "privacy") return sandboxPrivacyPayload(input.payload);
  return sandboxDecorPayload(input.payload);
}

function cleanReason(value: unknown): string {
  if (typeof value !== "string") throw new Error("REASON");
  const reason = value.trim().replace(/\s+/g, " ");
  if (reason.length < 1 || reason.length > 200) throw new Error("REASON");
  if (/<\s*script|https?:\/\//i.test(reason)) throw new Error("SANDBOX");
  return reason;
}

function sandboxExpandPayload(payload: unknown): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("SANDBOX");
  const raw = payload as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (key !== "from" && key !== "to" && key !== "reason") throw new Error("SANDBOX");
  }
  const from = raw.from;
  const to = raw.to;
  if (typeof from !== "number" || !Number.isInteger(from) || from < CLAIM_START_RADIUS) throw new Error("RADIUS");
  if (typeof to !== "number" || !Number.isInteger(to) || to < CLAIM_START_RADIUS || to === from) throw new Error("RADIUS");
  return canonical({ from, to, reason: cleanReason(raw.reason) });
}

function sandboxPrivacyPayload(payload: unknown): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("SANDBOX");
  const raw = payload as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (key !== "private" && key !== "reason") throw new Error("SANDBOX");
  }
  if (typeof raw.private !== "boolean") throw new Error("PRIVACY");
  return canonical({ private: raw.private, reason: cleanReason(raw.reason) });
}

export function territoryDay(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}

export function claimRadius(db: DatabaseSync): number {
  const rows = db.prepare("SELECT payload FROM chunk_edits WHERE kind = 'expand' ORDER BY seq ASC").all() as { payload: string }[];
  let radius = CLAIM_START_RADIUS;
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.payload) as { to?: unknown };
      if (typeof parsed.to === "number" && Number.isInteger(parsed.to) && parsed.to >= CLAIM_START_RADIUS) radius = parsed.to;
    } catch {
      /* a bad row does not shrink or grow the claim */
    }
  }
  return radius;
}

export function grownToday(db: DatabaseSync, now: number): number {
  const day = territoryDay(now);
  const rows = db.prepare("SELECT payload, at_ms FROM chunk_edits WHERE kind = 'expand' ORDER BY seq ASC").all() as { payload: string; at_ms: number }[];
  let sum = 0;
  for (const row of rows) {
    if (territoryDay(row.at_ms) !== day) continue;
    try {
      const parsed = JSON.parse(row.payload) as { from?: unknown; to?: unknown };
      const delta = Number(parsed.to) - Number(parsed.from);
      if (delta > 0) sum += delta;
    } catch {
      /* ignore */
    }
  }
  return sum;
}

export function chunkIsPrivate(db: DatabaseSync, cx: number, cy: number): boolean {
  const row = db.prepare(
    "SELECT payload FROM chunk_edits WHERE kind = 'privacy' AND chunk_x = ? AND chunk_y = ? ORDER BY seq DESC LIMIT 1",
  ).get(cx, cy) as { payload: string } | undefined;
  if (!row) return false;
  try {
    return (JSON.parse(row.payload) as { private?: unknown }).private === true;
  } catch {
    return false;
  }
}

export function territoryFrozen(db: DatabaseSync): boolean {
  return flag(db, "territory_frozen", "0") === "1";
}

/** Server edit gate. Visitors and any future plot are refused inside the claim and the buffer. */
function enforceTerritory(db: DatabaseSync, input: ChunkEditInput, payload: string): void {
  const radius = claimRadius(db);
  const zone = zoneAt(input.chunkX, input.chunkY, radius);
  const parsed = JSON.parse(payload) as { from?: number; to?: number };
  const shrinking = input.kind === "expand" && typeof parsed.to === "number" && typeof parsed.from === "number" && parsed.to < parsed.from;
  if (input.actor === "owner") {
    if (!shrinking) throw new Error(zone === "claim" ? "CLAIM" : zone === "buffer" ? "BUFFER" : "ACTOR");
    if (parsed.from !== radius || (parsed.to ?? 0) < CLAIM_START_RADIUS) throw new Error("VETO");
    return;
  }
  if (input.actor !== "zoora") {
    if (zone === "claim") throw new Error("CLAIM");
    if (zone === "buffer") throw new Error("BUFFER");
    throw new Error("ACTOR");
  }
  if (input.kind === "expand") {
    if (shrinking) throw new Error("VETO");
    if (territoryFrozen(db)) throw new Error("FROZEN");
    if (parsed.from !== radius) throw new Error("RADIUS");
    const step = (parsed.to ?? 0) - (parsed.from ?? 0);
    if (step < 1 || step > CLAIM_GROW_PER_DAY) throw new Error("STEP");
    if (grownToday(db, input.atMs) + step > CLAIM_GROW_PER_DAY) throw new Error("DAY");
    return;
  }
  if (zone !== "claim") throw new Error("OUTSIDE");
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
    enforceTerritory(db, input, payload);
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

/** Boot and predeploy. A broken chain is logged as one line. The caller exits. */
export function guardChunkChain(db: DatabaseSync): boolean {
  if (verifyChunkChain(db)) return true;
  console.log(JSON.stringify({ ts: new Date().toISOString(), event: "chunk_chain_broken", status: 500, route: "boot" }));
  return false;
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
