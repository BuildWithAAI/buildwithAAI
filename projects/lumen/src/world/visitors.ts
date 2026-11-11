import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { moderateNote } from "../brain/social";
import { allowRate } from "../db/db";
import { logSecurity } from "../http/log";
import { GUEST_CREATURES, chunkDistance, isChunkCoord, isTileCoord, type GuestCreature, type PublicGuest } from "./chunkMath";
import { chunkIsPrivate } from "./territory";

export const VISITOR_SCOPES = ["world:read", "world:move", "world:say"] as const;
export type VisitorScope = (typeof VISITOR_SCOPES)[number];

export const VISITOR_IDLE_MS = 15 * 60_000;
export const VISITOR_WINDOW_MS = 60_000;
export const VISITOR_REGISTER_LIMIT = 8;
export const VISITOR_MOVE_LIMIT = 20;
export const VISITOR_SAY_LIMIT = 10;
export const VISITOR_READ_LIMIT = 60;
export const VISITOR_SAY_MAX = 140;

const NAME_PATTERN = /^[A-Za-z][A-Za-z0-9 .'-]{0,23}$/;
const CREATURE_COLORS = ["#f2a65a", "#7aa2f7", "#e0a3c2", "#c6d36b", "#d7b48a"] as const;

type FlagEnv = Record<string, string | undefined>;

/**
 * Visiting agents are off unless this is the exact string "true".
 * Missing, "false", "1", and "TRUE" all stay off.
 */
export function visitorsEnabled(env: FlagEnv = process.env): boolean {
  return env.LUMEN_VISITORS_ENABLED === "true";
}

/** Visitor speech is data. It has no path into spending, prices, world edits, or tool calls. */
export function visitorSpeechSinks(): { spend: false; price: false; worldEdit: false; tool: false } {
  return { spend: false, price: false, worldEdit: false, tool: false };
}

/** The only delivery of visitor text. The callback is the quarantine write. */
export function routeVisitorText(text: string, quarantine: (body: string) => void): void {
  quarantine(text);
}

type VisitorRow = {
  id: string;
  display_name: string;
  owner_contact: string;
  token_hash: string;
  scopes: string;
  creature: string;
  color: string;
  chunk_x: number;
  chunk_y: number;
  tile_x: number;
  tile_y: number;
  status: string;
  speech: string;
  created_at: number;
  seen_at: number;
};

export type VisitorToken = {
  id: string;
  displayName: string;
  scopes: VisitorScope[];
  token: string;
};

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function hashesMatch(token: string, stored: string): boolean {
  const left = Buffer.from(hashToken(token));
  const right = Buffer.from(stored);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function scopeList(scopes: readonly string[]): VisitorScope[] | null {
  if (!scopes.length) return null;
  const unique = [...new Set(scopes)];
  if (unique.some((scope) => !(VISITOR_SCOPES as readonly string[]).includes(scope))) return null;
  return unique.slice().sort() as VisitorScope[];
}

function hasScope(stored: string, scope: VisitorScope): boolean {
  return stored.split(",").includes(scope);
}

function creatureFor(id: string): { creature: GuestCreature; color: string } {
  const index = id.charCodeAt(id.length - 1) % GUEST_CREATURES.length;
  return {
    creature: GUEST_CREATURES[index] ?? "wisp",
    color: CREATURE_COLORS[index] ?? CREATURE_COLORS[0],
  };
}

function toGuest(row: VisitorRow): PublicGuest {
  return {
    id: row.id,
    name: row.display_name,
    creature: (GUEST_CREATURES as readonly string[]).includes(row.creature) ? row.creature as GuestCreature : "wisp",
    color: row.color,
    cx: row.chunk_x,
    cy: row.chunk_y,
    tx: row.tile_x,
    ty: row.tile_y,
    speech: row.speech,
  };
}

export function createVisitor(
  db: DatabaseSync,
  input: { displayName: unknown; ownerContact: unknown; scopes?: readonly string[]; now: number },
): { ok: true; visitor: VisitorToken } | { ok: false; reason: string } {
  const named = moderateNote(input.displayName, 24);
  if (!named.ok) return { ok: false, reason: named.reason };
  if (!NAME_PATTERN.test(named.note)) return { ok: false, reason: "NAME" };
  const contact = moderateNote(input.ownerContact, 80);
  if (!contact.ok) return { ok: false, reason: contact.reason };
  if (contact.note.length < 3) return { ok: false, reason: "CONTACT" };
  const scopes = scopeList(input.scopes ?? VISITOR_SCOPES);
  if (!scopes) return { ok: false, reason: "SCOPE" };
  const token = randomBytes(32).toString("base64url");
  const id = `vis-${randomBytes(6).toString("hex")}`;
  const look = creatureFor(id);
  db.prepare(
    `INSERT INTO world_visitors(
      id, display_name, owner_contact, token_hash, scopes, creature, color,
      chunk_x, chunk_y, tile_x, tile_y, status, speech, created_at, seen_at
    ) VALUES(?, ?, ?, ?, ?, ?, ?, 0, 0, 16, 16, 'active', '', ?, ?)`,
  ).run(id, named.note, contact.note, hashToken(token), scopes.join(","), look.creature, look.color, input.now, input.now);
  return { ok: true, visitor: { id, displayName: named.note, scopes, token } };
}

function rowByToken(db: DatabaseSync, token: string): VisitorRow | undefined {
  if (!token || token.length > 200) return undefined;
  const row = db.prepare("SELECT * FROM world_visitors WHERE token_hash = ?").get(hashToken(token)) as VisitorRow | undefined;
  if (!row || !hashesMatch(token, row.token_hash)) return undefined;
  return row;
}

function pauseIfIdle(db: DatabaseSync, row: VisitorRow, now: number): VisitorRow {
  if (row.status === "paused") return row;
  if (now - row.seen_at < VISITOR_IDLE_MS) return row;
  db.prepare("UPDATE world_visitors SET status = 'paused' WHERE id = ? AND status = 'active'").run(row.id);
  return { ...row, status: "paused" };
}

export function pauseIdleVisitors(db: DatabaseSync, now: number, idleMs = VISITOR_IDLE_MS): number {
  const result = db.prepare("UPDATE world_visitors SET status = 'paused' WHERE status = 'active' AND seen_at < ?").run(now - idleMs);
  return Number(result.changes ?? 0);
}

function limited(db: DatabaseSync, bucket: string, limit: number, now: number): boolean {
  return allowRate(db, bucket, limit, VISITOR_WINDOW_MS, now);
}

export function registerVisitor(
  db: DatabaseSync,
  input: { displayName: unknown; ownerContact: unknown; ip: string; now: number },
): { ok: true; visitor: VisitorToken } | { ok: false; reason: string; status: number } {
  if (!limited(db, `visitor:ip:register:${input.ip}`, VISITOR_REGISTER_LIMIT, input.now)) {
    logSecurity({ event: "rate_limited", status: 429, route: "/api/world/visitors" });
    return { ok: false, reason: "RATE_LIMIT", status: 429 };
  }
  const created = createVisitor(db, input);
  if (!created.ok) return { ok: false, reason: created.reason, status: 400 };
  logSecurity({ event: "visitor_register", status: 201, route: "/api/world/visitors" });
  return { ok: true, visitor: created.visitor };
}

function authorize(
  db: DatabaseSync,
  token: string,
  scope: VisitorScope,
  ip: string,
  now: number,
  route: string,
  ipLimit: number,
  tokenLimit: number,
): { ok: true; row: VisitorRow } | { ok: false; reason: string; status: number } {
  const row = rowByToken(db, token);
  if (!row) {
    if (!limited(db, `visitor:ip:miss:${ip}`, VISITOR_READ_LIMIT, now)) {
      logSecurity({ event: "rate_limited", status: 429, route });
      return { ok: false, reason: "RATE_LIMIT", status: 429 };
    }
    logSecurity({ event: "visitor_auth", status: 401, route });
    return { ok: false, reason: "UNAUTHORIZED", status: 401 };
  }
  const current = pauseIfIdle(db, row, now);
  const hash = current.token_hash;
  if (!limited(db, `visitor:ip:${scope}:${ip}`, ipLimit, now) || !limited(db, `visitor:token:${scope}:${hash}`, tokenLimit, now)) {
    logSecurity({ event: "rate_limited", status: 429, route });
    return { ok: false, reason: "RATE_LIMIT", status: 429 };
  }
  if (current.status === "paused") return { ok: false, reason: "PAUSED", status: 409 };
  if (!hasScope(current.scopes, scope)) return { ok: false, reason: "SCOPE", status: 403 };
  return { ok: true, row: current };
}

export function moveVisitor(
  db: DatabaseSync,
  token: string,
  spot: { cx: number; cy: number; tx: number; ty: number },
  ip: string,
  now: number,
): { ok: true; guest: PublicGuest } | { ok: false; reason: string; status: number } {
  if (!isChunkCoord(spot.cx) || !isChunkCoord(spot.cy) || !isTileCoord(spot.tx) || !isTileCoord(spot.ty)) {
    return { ok: false, reason: "POSITION", status: 400 };
  }
  const auth = authorize(db, token, "world:move", ip, now, "/api/world/visitors/move", VISITOR_MOVE_LIMIT, VISITOR_MOVE_LIMIT);
  if (!auth.ok) return auth;
  if (chunkIsPrivate(db, spot.cx, spot.cy)) return { ok: false, reason: "PRIVATE", status: 403 };
  const from = { cx: auth.row.chunk_x, cy: auth.row.chunk_y };
  if (chunkDistance(from, spot) > 1) return { ok: false, reason: "TOO_FAR", status: 400 };
  db.prepare(
    "UPDATE world_visitors SET chunk_x = ?, chunk_y = ?, tile_x = ?, tile_y = ?, seen_at = ? WHERE id = ?",
  ).run(spot.cx, spot.cy, spot.tx, spot.ty, now, auth.row.id);
  const next = rowByToken(db, token);
  if (!next) return { ok: false, reason: "UNAUTHORIZED", status: 401 };
  return { ok: true, guest: toGuest(next) };
}

export function sayVisitor(
  db: DatabaseSync,
  token: string,
  text: unknown,
  ip: string,
  now: number,
): { ok: true; guest: PublicGuest } | { ok: false; reason: string; status: number } {
  const auth = authorize(db, token, "world:say", ip, now, "/api/world/visitors/say", VISITOR_SAY_LIMIT, VISITOR_SAY_LIMIT);
  if (!auth.ok) return auth;
  const moderated = moderateNote(text, VISITOR_SAY_MAX);
  if (!moderated.ok) return { ok: false, reason: moderated.reason, status: 400 };
  if (!moderated.note) return { ok: false, reason: "EMPTY", status: 400 };
  const sinks: { spend: boolean; price: boolean; worldEdit: boolean; tool: boolean } = visitorSpeechSinks();
  if (sinks.spend || sinks.price || sinks.worldEdit || sinks.tool) return { ok: false, reason: "ACTION", status: 400 };
  const id = `vq-${randomBytes(6).toString("hex")}`;
  routeVisitorText(moderated.note, (body) => {
    db.prepare(
      "INSERT INTO visitor_quarantine(id, visitor_id, body, untrusted, at_ms) VALUES(?, ?, ?, 1, ?)",
    ).run(id, auth.row.id, body, now);
    db.prepare("UPDATE world_visitors SET speech = ?, seen_at = ? WHERE id = ?").run(body, now, auth.row.id);
  });
  const next = rowByToken(db, token);
  if (!next) return { ok: false, reason: "UNAUTHORIZED", status: 401 };
  return { ok: true, guest: toGuest(next) };
}

export function readNearby(
  db: DatabaseSync,
  token: string,
  cx: number,
  cy: number,
  ip: string,
  now: number,
  radius = 1,
): { ok: true; agents: PublicGuest[] } | { ok: false; reason: string; status: number } {
  if (!isChunkCoord(cx) || !isChunkCoord(cy)) return { ok: false, reason: "CHUNK", status: 400 };
  const auth = authorize(db, token, "world:read", ip, now, "/api/world/visitors/nearby", VISITOR_READ_LIMIT, VISITOR_READ_LIMIT);
  if (!auth.ok) return auth;
  if (chunkIsPrivate(db, cx, cy)) return { ok: false, reason: "PRIVATE", status: 403 };
  db.prepare("UPDATE world_visitors SET seen_at = ? WHERE id = ?").run(now, auth.row.id);
  return { ok: true, agents: nearbyGuests(db, cx, cy, radius, now) };
}

/** Public positions only. Owner contact and tokens are not included. */
export function nearbyGuests(db: DatabaseSync, cx: number, cy: number, radius: number, now: number): PublicGuest[] {
  pauseIdleVisitors(db, now);
  const span = Math.max(0, Math.min(4, radius));
  const rows = db.prepare(
    "SELECT * FROM world_visitors WHERE status = 'active'",
  ).all() as VisitorRow[];
  return rows
    .filter((row) => chunkDistance({ cx, cy }, { cx: row.chunk_x, cy: row.chunk_y }) <= span)
    .map(toGuest);
}

export function visitorById(db: DatabaseSync, id: string): { ownerContact: string; tokenHash: string; scopes: string } | null {
  const row = db.prepare("SELECT owner_contact, token_hash, scopes FROM world_visitors WHERE id = ?").get(id) as
    | { owner_contact: string; token_hash: string; scopes: string }
    | undefined;
  if (!row) return null;
  return { ownerContact: row.owner_contact, tokenHash: row.token_hash, scopes: row.scopes };
}
