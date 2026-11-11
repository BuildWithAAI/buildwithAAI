import { createHash, randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { CHUNK_COORD_LIMIT, isChunkCoord, isTileCoord, type PublicDecor } from "./chunkMath";
import { CLAIM_GROW_PER_DAY, CLAIM_START_RADIUS, claimCeiling, zoneAt } from "./territoryRules";

export const CHUNK_EDIT_KINDS = ["decor", "decor-rollback", "privacy", "expand"] as const;
/** Rows at this version include id, time, and the idempotency key in the body hash. */
export const CHUNK_EDIT_HASH_VERSION = 2;
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

function sandboxGrowthProvenance(value: unknown): { who: "zoora" | "owner"; what: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("SANDBOX");
  const raw = value as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (key !== "who" && key !== "what") throw new Error("SANDBOX");
  }
  if (raw.who !== "zoora" && raw.who !== "owner") throw new Error("SANDBOX");
  if (typeof raw.what !== "string" || !/^[a-z0-9:-]{1,64}$/.test(raw.what)) throw new Error("SANDBOX");
  return { who: raw.who, what: raw.what };
}

function sandboxExpandPayload(payload: unknown): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("SANDBOX");
  const raw = payload as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (key !== "from" && key !== "to" && key !== "reason" && key !== "provenance") throw new Error("SANDBOX");
  }
  const from = raw.from;
  const to = raw.to;
  if (typeof from !== "number" || !Number.isInteger(from) || from < CLAIM_START_RADIUS) throw new Error("RADIUS");
  if (typeof to !== "number" || !Number.isInteger(to) || to < CLAIM_START_RADIUS || to === from) throw new Error("RADIUS");
  const provenance = raw.provenance == null ? undefined : sandboxGrowthProvenance(raw.provenance);
  return canonical({ from, to, reason: cleanReason(raw.reason), ...(provenance ? { provenance } : {}) });
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

const CLAIM_RADIUS_KEY = "claim_radius";

function scanClaimRadius(db: DatabaseSync): number {
  const rows = db.prepare("SELECT payload FROM chunk_edits WHERE kind = 'expand' ORDER BY seq ASC").all() as { payload: string }[];
  let radius = CLAIM_START_RADIUS;
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.payload) as { to?: unknown };
      if (typeof parsed.to === "number" && Number.isInteger(parsed.to) && parsed.to >= CLAIM_START_RADIUS) {
        radius = Math.min(parsed.to, CHUNK_COORD_LIMIT);
      }
    } catch {
      /* a bad row does not shrink or grow the claim */
    }
  }
  return radius;
}

function writeCachedRadius(db: DatabaseSync, radius: number): void {
  db.prepare("INSERT INTO kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(CLAIM_RADIUS_KEY, String(radius));
}

/** Boot overwrites kv from the chain, including a stale or oversized cache. */
export function rebuildClaimRadius(db: DatabaseSync): number {
  const radius = scanClaimRadius(db);
  writeCachedRadius(db, radius);
  return radius;
}

/** Cached. Growth and veto refresh it. A miss scans the chain once. */
export function claimRadius(db: DatabaseSync): number {
  const row = db.prepare("SELECT value FROM kv WHERE key = ?").get(CLAIM_RADIUS_KEY) as { value: string } | undefined;
  if (row && /^\d+$/.test(row.value)) {
    const cached = Number(row.value);
    if (cached >= CLAIM_START_RADIUS && cached <= CHUNK_COORD_LIMIT) return cached;
  }
  const radius = scanClaimRadius(db);
  writeCachedRadius(db, radius);
  return radius;
}

export function grownToday(db: DatabaseSync, now = Date.now()): number {
  const day = territoryDay(now);
  const rows = db.prepare("SELECT payload, at_ms FROM chunk_edits WHERE kind = 'expand' ORDER BY seq ASC").all() as { payload: string; at_ms: number }[];
  let sum = 0;
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.payload) as { from?: unknown; to?: unknown; day?: unknown };
      const rowDay = typeof parsed.day === "string" ? parsed.day : territoryDay(row.at_ms);
      if (rowDay !== day) continue;
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
  const row = db.prepare("SELECT value FROM flags WHERE key = 'territory_frozen'").get() as { value: string } | undefined;
  return row?.value === "1";
}

/** Server edit gate. Visitors and any future plot are refused inside the claim and the buffer. */
function enforceTerritory(db: DatabaseSync, input: ChunkEditInput, payload: string): void {
  const radius = claimRadius(db);
  const zone = zoneAt(input.chunkX, input.chunkY, radius);
  const parsed = JSON.parse(payload) as { from?: number; to?: number; private?: boolean };
  const shrinking = input.kind === "expand" && typeof parsed.to === "number" && typeof parsed.from === "number" && parsed.to < parsed.from;
  if (input.kind === "privacy" && input.chunkX === 0 && input.chunkY === 0 && parsed.private === true) throw new Error("HOME");
  if (input.actor === "owner") {
    if (input.kind === "privacy") {
      if (parsed.private !== false) throw new Error("ACTOR");
      return;
    }
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
    if (grownToday(db, Date.now()) + step > CLAIM_GROW_PER_DAY) throw new Error("DAY");
    if ((parsed.to ?? 0) > CHUNK_COORD_LIMIT) throw new Error("EDGE");
    const ceiling = claimCeiling();
    if (ceiling != null && (parsed.to ?? 0) > ceiling) throw new Error("CEILING");
    return;
  }
  if (zone !== "claim") throw new Error("OUTSIDE");
}

function tailHashOk(db: DatabaseSync): boolean {
  const tail = db.prepare("SELECT * FROM chunk_edits ORDER BY seq DESC LIMIT 1").get() as Record<string, unknown> | undefined;
  if (!tail) return true;
  const row = mapEdit(tail);
  const hash = chunkEditBodyHash(row);
  if (hash !== row.bodyHash) return false;
  const entry = createHash("sha256").update(row.prevHash + hash).digest("hex");
  return entry === row.entryHash;
}

/** Veto, a radius reset, and make-public stay available while writes are frozen. */
function ownerRecovery(input: ChunkEditInput): boolean {
  if (input.actor !== "owner" || !input.payload || typeof input.payload !== "object" || Array.isArray(input.payload)) return false;
  const raw = input.payload as Record<string, unknown>;
  if (input.kind === "privacy") return raw.private === false;
  if (input.kind === "expand") {
    return typeof raw.from === "number" && typeof raw.to === "number" && raw.to < raw.from && raw.to >= CLAIM_START_RADIUS;
  }
  return false;
}

/** Full-chain check spacing. Boot always verifies. A mid-chain edit is caught on this cadence and then frozen. */
export const CHUNK_CHAIN_FULL_VERIFY_EVERY = 32;

function fullVerifyDue(db: DatabaseSync): boolean {
  const count = Number((db.prepare("SELECT COUNT(*) AS n FROM chunk_edits").get() as { n: number }).n);
  return count > 0 && count % CHUNK_CHAIN_FULL_VERIFY_EVERY === 0;
}

export function appendChunkEdit(db: DatabaseSync, input: ChunkEditInput): ChunkEditRow {
  if (!tailHashOk(db)) {
    degradeChunkChain(db);
    throw new Error("CHAIN");
  }
  if (fullVerifyDue(db) && !verifyChunkChain(db)) {
    degradeChunkChain(db);
    throw new Error("CHAIN");
  }
  if (chunkWritesFrozen(db) && (!ownerRecovery(input) || !verifyChunkChain(db))) throw new Error("CHAIN");
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
    const storedPayload = stampGrowthDay(input.kind, payload);
    const hash = chunkEditBodyHash({ ...input, payload: storedPayload });
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
        (id, at_ms, chunk_x, chunk_y, tile_x, tile_y, kind, payload, actor, idempotency_key, prev_hash, body_hash, entry_hash, hash_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.id,
      input.atMs,
      input.chunkX,
      input.chunkY,
      input.tileX,
      input.tileY,
      input.kind,
      storedPayload,
      input.actor,
      input.idempotencyKey,
      prevHash,
      hash,
      entryHash,
      CHUNK_EDIT_HASH_VERSION,
    );
    const row = db.prepare("SELECT * FROM chunk_edits WHERE id = ?").get(input.id) as Record<string, unknown>;
    if (input.kind === "expand") {
      const to = (JSON.parse(storedPayload) as { to?: unknown }).to;
      if (typeof to === "number" && Number.isInteger(to) && to >= CLAIM_START_RADIUS) writeCachedRadius(db, to);
    }
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

/** The growth day is the server clock. A caller cannot put their own timestamp in the cap. */
function stampGrowthDay(kind: string, payload: string): string {
  if (kind !== "expand") return payload;
  const parsed = JSON.parse(payload) as Record<string, unknown>;
  parsed.day = territoryDay(Date.now());
  return canonical(parsed);
}

/** Body hash from before id, time, and the idempotency key were covered. */
export function legacyChunkEditBodyHash(input: {
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

function verifyLegacyChunkChain(rows: ChunkEditRow[]): boolean {
  let prev = "GENESIS";
  for (const row of rows) {
    const hash = legacyChunkEditBodyHash(row);
    if (hash !== row.bodyHash || row.prevHash !== prev) return false;
    const entry = createHash("sha256").update(prev + hash).digest("hex");
    if (entry !== row.entryHash) return false;
    prev = entry;
  }
  return true;
}

/**
 * One-time rewrite of pre-change rows onto the current hash, then a new chain.
 * A chain that matches neither the old hash nor the new one is left untouched.
 */
export function migrateChunkEditHashes(db: DatabaseSync): void {
  const pending = Number((db.prepare("SELECT COUNT(*) AS n FROM chunk_edits WHERE hash_version < ?").get(CHUNK_EDIT_HASH_VERSION) as { n: number }).n);
  if (pending === 0) {
    db.prepare("INSERT INTO kv(key, value) VALUES('chunk_edit_hash_version', '2') ON CONFLICT(key) DO UPDATE SET value = '2'").run();
    return;
  }
  const rows = listChunkEdits(db);
  if (verifyChunkChain(db)) {
    restampChunkHashVersion(db);
    return;
  }
  if (!verifyLegacyChunkChain(rows)) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec("DROP TRIGGER IF EXISTS chunk_edits_no_update");
    db.exec("DROP INDEX IF EXISTS chunk_edits_prev");
    const update = db.prepare("UPDATE chunk_edits SET body_hash = ?, prev_hash = ?, entry_hash = ?, hash_version = ? WHERE id = ?");
    let prev = "GENESIS";
    for (const row of rows) {
      const hash = chunkEditBodyHash(row);
      const entry = createHash("sha256").update(prev + hash).digest("hex");
      update.run(hash, prev, entry, CHUNK_EDIT_HASH_VERSION, row.id);
      prev = entry;
    }
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS chunk_edits_prev ON chunk_edits(prev_hash)");
    db.exec("CREATE TRIGGER IF NOT EXISTS chunk_edits_no_update BEFORE UPDATE ON chunk_edits BEGIN SELECT RAISE(ABORT, 'append-only'); END");
    db.prepare("INSERT INTO kv(key, value) VALUES('chunk_edit_hash_version', '2') ON CONFLICT(key) DO UPDATE SET value = '2'").run();
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* already closed */ }
    throw error;
  }
}

function restampChunkHashVersion(db: DatabaseSync): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec("DROP TRIGGER IF EXISTS chunk_edits_no_update");
    db.prepare("UPDATE chunk_edits SET hash_version = ? WHERE hash_version < ?").run(CHUNK_EDIT_HASH_VERSION, CHUNK_EDIT_HASH_VERSION);
    db.exec("CREATE TRIGGER IF NOT EXISTS chunk_edits_no_update BEFORE UPDATE ON chunk_edits BEGIN SELECT RAISE(ABORT, 'append-only'); END");
    db.prepare("INSERT INTO kv(key, value) VALUES('chunk_edit_hash_version', '2') ON CONFLICT(key) DO UPDATE SET value = '2'").run();
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* already closed */ }
    throw error;
  }
}

/** Boot and predeploy. A broken chain is logged as one line. Boot degrades. Predeploy exits. */
export function guardChunkChain(db: DatabaseSync): boolean {
  if (verifyChunkChain(db)) return true;
  console.log(JSON.stringify({ ts: new Date().toISOString(), event: "chunk_chain_broken", status: 500, route: "boot" }));
  return false;
}

export function chunkWritesFrozen(db: DatabaseSync): boolean {
  const row = db.prepare("SELECT value FROM flags WHERE key = 'chunk_chain_broken'").get() as { value: string } | undefined;
  return row?.value === "1";
}

function rememberFlag(db: DatabaseSync, key: string, value: string): void {
  db.prepare("INSERT INTO flags(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

/**
 * A broken decor chain stays up. Creative and territory writes freeze, the desk keeps the notice,
 * and callers serve terrain without decor. Predeploy is the path that exits.
 */
export function degradeChunkChain(db: DatabaseSync, now = Date.now()): void {
  noteChunkChainBroken(db, now);
  rememberFlag(db, "chunk_chain_broken", "1");
  rememberFlag(db, "territory_frozen", "1");
  rememberFlag(db, "creative_building", "0");
  console.log(JSON.stringify({ ts: new Date(now).toISOString(), event: "chunk_chain_degraded", status: 500, route: "boot" }));
}

export function clearChunkChainBroken(db: DatabaseSync): void {
  const wasBroken = chunkWritesFrozen(db);
  rememberFlag(db, "chunk_chain_broken", "0");
  if (wasBroken) {
    rememberFlag(db, "territory_frozen", "0");
    rememberFlag(db, "creative_building", "1");
  }
  db.prepare("DELETE FROM owner_alerts WHERE title = ?").run("Chunk chain broken");
}

/** Owner desk. A good chain clears the freeze flag. A bad one stays degraded. */
export function reverifyChunkChain(db: DatabaseSync, now = Date.now()): { ok: true } | { ok: false; reason: string } {
  rebuildClaimRadius(db);
  if (!verifyChunkChain(db)) {
    degradeChunkChain(db, now);
    return { ok: false, reason: "CHAIN" };
  }
  clearChunkChainBroken(db);
  return { ok: true };
}

/** Desk notice that stays until the next login. A second failure does not add another row. */
export function noteChunkChainBroken(db: DatabaseSync, now = Date.now()): void {
  const title = "Chunk chain broken";
  const existing = db.prepare("SELECT id FROM owner_alerts WHERE title = ?").get(title);
  if (existing) return;
  db.prepare("INSERT INTO owner_alerts(id, kind, title, detail, created_at) VALUES(?, 'ledger', ?, ?, ?)").run(
    randomBytes(8).toString("hex"),
    title,
    "The chunk edit chain failed verification. The site stays up. Creative and territory writes are frozen, and chunks are served without decor. This notice stays on the desk.",
    now,
  );
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
  const hidden = db.prepare("SELECT id FROM world_builds WHERE status != 'placed'").all() as { id: string }[];
  for (const row of hidden) live.delete(row.id);
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
