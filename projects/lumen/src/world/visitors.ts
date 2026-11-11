import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { CRISIS_REPLY, crisisMatch } from "../brain/crisis";
import { moderateNote, textForCheck } from "../brain/social";
import { allowRate } from "../db/db";
import { logSecurity } from "../http/log";
import { textHasPan } from "../money/pan";
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
export const VISITOR_MAX_ROWS = 200;
export const VISITOR_PREFIX_ROWS = 32;
export const VISITOR_GLOBAL_REGISTER_LIMIT = 30;
export const VISITOR_V6_PREFIX_LIMIT = 8;
export const VISITOR_V6_48_LIMIT = 8;
export const VISITOR_ACTIVE_PER_IP = 8;
export const VISITOR_ACTIVE_PER_V4_24 = 16;
export const VISITOR_ACTIVE_PER_V6_48 = 16;
export const VISITOR_KEEP_MS = 7 * 24 * 60 * 60 * 1000;
export const VISITOR_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const QUARANTINE_KEEP = 1_000;
export const QUARANTINE_KEEP_MS = 7 * 24 * 60 * 60 * 1000;
export const NEARBY_LIMIT = 64;
export const VISITOR_CAP_ALERT_MS = 60 * 60 * 1000;

const CAP_TITLE = "Visitor registration cap";

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
  speech_untrusted: number;
  reg_prefix: string;
  created_at: number;
  seen_at: number;
  expires_at: number;
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
    untrusted: true,
  };
}

/** First 64 bits of an IPv6 address. IPv4 and anything dotted stays on the full address. */
export function ipv6Prefix64(ip: string): string | null {
  const raw = ip.trim().toLowerCase();
  if (!raw.includes(":") || raw.includes(".")) return null;
  if (!/^[0-9a-f:]+$/.test(raw)) return null;
  const halves = raw.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":").filter(Boolean) : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":").filter(Boolean) : [];
  const parts = halves.length === 1 ? head : [...head, ...Array(Math.max(0, 8 - head.length - tail.length)).fill("0"), ...tail];
  if (parts.length !== 8) return null;
  return parts.slice(0, 4).map((part) => String(Number.parseInt(part || "0", 16))).join(":");
}

export function registrationPrefix(ip: string): string {
  return ipv6Prefix64(ip) ?? ip.slice(0, 64);
}

/** First 48 bits. Accepts a full address or a stored /64 prefix. */
export function ipv6Prefix48(ip: string): string | null {
  const full = ipv6Prefix64(ip);
  const prefix = full ?? (/^[0-9a-f:]+$/i.test(ip) && ip.includes(":") ? ip : null);
  if (!prefix) return null;
  const parts = prefix.split(":").filter(Boolean);
  if (parts.length < 3) return null;
  return parts.slice(0, 3).join(":");
}

export function ipv4Prefix24(ip: string): string | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip.trim());
  if (!match) return null;
  const octets = match.slice(1).map((part) => Number(part));
  if (octets.some((part) => part > 255)) return null;
  return `${octets[0]}.${octets[1]}.${octets[2]}`;
}

export function pruneQuarantine(db: DatabaseSync, now: number): void {
  db.prepare("DELETE FROM visitor_quarantine WHERE at_ms < ?").run(now - QUARANTINE_KEEP_MS);
  db.prepare(`DELETE FROM visitor_quarantine WHERE rowid NOT IN (SELECT rowid FROM visitor_quarantine ORDER BY at_ms DESC LIMIT ${QUARANTINE_KEEP})`).run();
}

/** Drop revoked, expired, and rows that have been quiet for the retention window. */
export function pruneVisitors(db: DatabaseSync, now: number): void {
  db.prepare("DELETE FROM world_visitors WHERE status = 'revoked' OR expires_at <= ? OR seen_at < ?").run(now, now - VISITOR_KEEP_MS);
  pruneQuarantine(db, now);
}

/**
 * Idle, paused, or never-active (seen_at still equal to created_at), oldest last activity first.
 * A visitor who has moved or spoken inside the idle window is not a candidate.
 */
function evictVisitor(db: DatabaseSync, id: string): void {
  db.prepare("DELETE FROM visitor_quarantine WHERE visitor_id = ?").run(id);
  db.prepare("DELETE FROM world_visitors WHERE id = ?").run(id);
}

function evictIdleVisitor(db: DatabaseSync, now: number): boolean {
  const row = db.prepare(
    `SELECT id FROM world_visitors
     WHERE status = 'paused' OR status = 'revoked' OR seen_at = created_at OR seen_at <= ?
     ORDER BY seen_at ASC, created_at ASC, id ASC
     LIMIT 1`,
  ).get(now - VISITOR_IDLE_MS) as { id: string } | undefined;
  if (!row) return false;
  evictVisitor(db, row.id);
  return true;
}

/** Oldest account on the prefix that currently holds the most rows. */
function evictHeaviestPrefix(db: DatabaseSync): boolean {
  const row = db.prepare(
    `SELECT id FROM world_visitors
     WHERE status != 'revoked' AND reg_prefix = (
       SELECT reg_prefix FROM world_visitors
       WHERE status != 'revoked'
       GROUP BY reg_prefix
       ORDER BY COUNT(*) DESC, reg_prefix ASC
       LIMIT 1
     )
     ORDER BY created_at ASC, id ASC
     LIMIT 1`,
  ).get() as { id: string } | undefined;
  if (!row) return false;
  evictVisitor(db, row.id);
  return true;
}

function activePrefixes(db: DatabaseSync, now: number): string[] {
  return (db.prepare(
    "SELECT reg_prefix FROM world_visitors WHERE status = 'active' AND seen_at > ? AND expires_at > ?",
  ).all(now - VISITOR_IDLE_MS, now) as { reg_prefix: string }[]).map((row) => row.reg_prefix);
}

function activeCapReached(db: DatabaseSync, ip: string, now: number): boolean {
  const rows = activePrefixes(db, now);
  const exact = registrationPrefix(ip);
  if (rows.filter((prefix) => prefix === exact).length >= VISITOR_ACTIVE_PER_IP) return true;
  const v4 = ipv4Prefix24(ip);
  if (v4 && rows.filter((prefix) => ipv4Prefix24(prefix) === v4).length >= VISITOR_ACTIVE_PER_V4_24) return true;
  const v6 = ipv6Prefix48(ip);
  if (v6 && rows.filter((prefix) => ipv6Prefix48(prefix) === v6).length >= VISITOR_ACTIVE_PER_V6_48) return true;
  return false;
}

function noteVisitorCap(db: DatabaseSync, now: number, evicted: boolean): void {
  const recent = db.prepare("SELECT created_at FROM owner_alerts WHERE title = ? ORDER BY created_at DESC LIMIT 1").get(CAP_TITLE) as { created_at: number } | undefined;
  if (recent && now - recent.created_at < VISITOR_CAP_ALERT_MS) return;
  logSecurity({ event: "visitor_cap", status: evicted ? 200 : 429, route: "/api/world/visitors" });
  db.prepare("INSERT INTO owner_alerts(id, kind, title, detail, created_at) VALUES(?, 'world', ?, ?, ?)").run(
    randomBytes(8).toString("hex"),
    CAP_TITLE,
    evicted
      ? "The visitor list was full. The oldest idle or never-active visitor was removed so a new one could register."
      : "The visitor list is full of active visitors. Registration was refused.",
    now,
  );
}

/** Home first, then the nearest public chunk. A private chunk is never a spawn. */
function spawnSpot(db: DatabaseSync): { cx: number; cy: number; tx: number; ty: number } {
  for (let radius = 0; radius <= 32; radius += 1) {
    for (let cy = -radius; cy <= radius; cy += 1) {
      for (let cx = -radius; cx <= radius; cx += 1) {
        if (Math.max(Math.abs(cx), Math.abs(cy)) !== radius) continue;
        if (!chunkIsPrivate(db, cx, cy)) return { cx, cy, tx: 16, ty: 16 };
      }
    }
  }
  return { cx: 1, cy: 0, tx: 16, ty: 16 };
}

function visitorCount(db: DatabaseSync): number {
  return Number((db.prepare("SELECT COUNT(*) AS n FROM world_visitors").get() as { n: number }).n);
}

export function createVisitor(
  db: DatabaseSync,
  input: { displayName: unknown; ownerContact: unknown; scopes?: readonly string[]; now: number; ip?: string },
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
  const prefix = registrationPrefix(input.ip ?? "direct");
  const spot = spawnSpot(db);
  db.prepare(
    `INSERT INTO world_visitors(
      id, display_name, owner_contact, token_hash, scopes, creature, color,
      chunk_x, chunk_y, tile_x, tile_y, status, speech, speech_untrusted, reg_prefix, created_at, seen_at, expires_at
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', '', 1, ?, ?, ?, ?)`,
  ).run(id, named.note, contact.note, hashToken(token), scopes.join(","), look.creature, look.color, spot.cx, spot.cy, spot.tx, spot.ty, prefix, input.now, input.now, input.now + VISITOR_TOKEN_TTL_MS);
  return { ok: true, visitor: { id, displayName: named.note, scopes, token } };
}

function rowByToken(db: DatabaseSync, token: string, now: number): VisitorRow | undefined {
  if (!token || token.length > 200) return undefined;
  const row = db.prepare("SELECT * FROM world_visitors WHERE token_hash = ?").get(hashToken(token)) as VisitorRow | undefined;
  if (!row || !hashesMatch(token, row.token_hash)) return undefined;
  if (row.status === "revoked" || row.expires_at <= now) return undefined;
  return row;
}

function pauseIfIdle(db: DatabaseSync, row: VisitorRow, now: number, write: boolean): VisitorRow {
  if (row.status === "paused" || row.status === "revoked") return row;
  if (now - row.seen_at < VISITOR_IDLE_MS) return row;
  if (write) db.prepare("UPDATE world_visitors SET status = 'paused' WHERE id = ? AND status = 'active'").run(row.id);
  return { ...row, status: "paused" };
}

export function revokeVisitor(db: DatabaseSync, id: string, now: number): { ok: true } | { ok: false; reason: string } {
  const result = db.prepare("UPDATE world_visitors SET status = 'revoked', expires_at = ? WHERE id = ? AND status != 'revoked'").run(now, id);
  return Number(result.changes ?? 0) > 0 ? { ok: true } : { ok: false, reason: "MISSING" };
}

export function revokeVisitorToken(db: DatabaseSync, token: string, now: number): { ok: true } | { ok: false; reason: string } {
  const row = rowByToken(db, token, now);
  if (!row) return { ok: false, reason: "UNAUTHORIZED" };
  return revokeVisitor(db, row.id, now);
}

function limited(db: DatabaseSync, bucket: string, limit: number, now: number): boolean {
  return allowRate(db, bucket, limit, VISITOR_WINDOW_MS, now);
}

function withImmediate<T>(db: DatabaseSync, run: () => T): T {
  let owns = false;
  try {
    db.exec("BEGIN IMMEDIATE");
    owns = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/within a transaction/i.test(message)) throw error;
  }
  try {
    const value = run();
    if (owns) db.exec("COMMIT");
    return value;
  } catch (error) {
    if (owns) {
      try { db.exec("ROLLBACK"); } catch { /* already closed */ }
    }
    throw error;
  }
}

export function registerVisitor(
  db: DatabaseSync,
  input: { displayName: unknown; ownerContact: unknown; ip: string; now: number },
): { ok: true; visitor: VisitorToken } | { ok: false; reason: string; status: number } {
  const v6 = ipv6Prefix64(input.ip);
  const v48 = ipv6Prefix48(input.ip);
  if (!limited(db, "visitor:register:global", VISITOR_GLOBAL_REGISTER_LIMIT, input.now)
    || !limited(db, `visitor:ip:register:${input.ip}`, VISITOR_REGISTER_LIMIT, input.now)
    || (v6 !== null && !limited(db, `visitor:v6:${v6}`, VISITOR_V6_PREFIX_LIMIT, input.now))
    || (v48 !== null && !limited(db, `visitor:v6-48:${v48}`, VISITOR_V6_48_LIMIT, input.now))) {
    logSecurity({ event: "rate_limited", status: 429, route: "/api/world/visitors" });
    return { ok: false, reason: "RATE_LIMIT", status: 429 };
  }
  return withImmediate(db, () => {
    pruneVisitors(db, input.now);
    const prefix = registrationPrefix(input.ip);
    const prefixRows = Number((db.prepare(
      "SELECT COUNT(*) AS n FROM world_visitors WHERE reg_prefix = ? AND status != 'revoked' AND expires_at > ?",
    ).get(prefix, input.now) as { n: number }).n);
    if (prefixRows >= VISITOR_PREFIX_ROWS) {
      logSecurity({ event: "rate_limited", status: 429, route: "/api/world/visitors" });
      return { ok: false, reason: "PREFIX", status: 429 };
    }
    if (activeCapReached(db, input.ip, input.now)) {
      logSecurity({ event: "rate_limited", status: 429, route: "/api/world/visitors" });
      return { ok: false, reason: "ACTIVE", status: 429 };
    }
    if (visitorCount(db) >= VISITOR_MAX_ROWS) {
      const evicted = evictIdleVisitor(db, input.now) || evictHeaviestPrefix(db);
      noteVisitorCap(db, input.now, evicted);
      if (!evicted || visitorCount(db) >= VISITOR_MAX_ROWS) {
        logSecurity({ event: "rate_limited", status: 429, route: "/api/world/visitors" });
        return { ok: false, reason: "CAP", status: 429 };
      }
    }
    const created = createVisitor(db, input);
    if (!created.ok) return { ok: false, reason: created.reason, status: 400 };
    logSecurity({ event: "visitor_register", status: 201, route: "/api/world/visitors" });
    return { ok: true, visitor: created.visitor };
  });
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
  write: boolean,
): { ok: true; row: VisitorRow } | { ok: false; reason: string; status: number } {
  const row = rowByToken(db, token, now);
  if (!row) {
    if (!limited(db, `visitor:ip:miss:${ip}`, VISITOR_READ_LIMIT, now)) {
      logSecurity({ event: "rate_limited", status: 429, route });
      return { ok: false, reason: "RATE_LIMIT", status: 429 };
    }
    logSecurity({ event: "visitor_auth", status: 401, route });
    return { ok: false, reason: "UNAUTHORIZED", status: 401 };
  }
  const current = pauseIfIdle(db, row, now, write);
  const hash = current.token_hash;
  const v4 = ipv4Prefix24(ip);
  const v48 = ipv6Prefix48(ip);
  if (!limited(db, `visitor:ip:${scope}:${ip}`, ipLimit, now)
    || !limited(db, `visitor:token:${scope}:${hash}`, tokenLimit, now)
    || (v4 !== null && !limited(db, `visitor:v4:${scope}:${v4}`, ipLimit, now))
    || (v48 !== null && !limited(db, `visitor:v6-48:${scope}:${v48}`, ipLimit, now))) {
    logSecurity({ event: "rate_limited", status: 429, route });
    return { ok: false, reason: "RATE_LIMIT", status: 429 };
  }
  if (current.status === "paused") return { ok: false, reason: "PAUSED", status: 409 };
  if (!hasScope(current.scopes, scope)) return { ok: false, reason: "SCOPE", status: 403 };
  return { ok: true, row: current };
}

/** A paused or idle visitor comes back with this call. Move and say stay closed until then. */
export function resumeVisitor(
  db: DatabaseSync,
  token: string,
  ip: string,
  now: number,
): { ok: true; guest: PublicGuest } | { ok: false; reason: string; status: number } {
  const row = rowByToken(db, token, now);
  if (!row) {
    logSecurity({ event: "visitor_auth", status: 401, route: "/api/world/visitors/resume" });
    return { ok: false, reason: "UNAUTHORIZED", status: 401 };
  }
  if (!limited(db, `visitor:ip:world:say:${ip}`, VISITOR_SAY_LIMIT, now) || !limited(db, `visitor:token:world:say:${row.token_hash}`, VISITOR_SAY_LIMIT, now)) {
    logSecurity({ event: "rate_limited", status: 429, route: "/api/world/visitors/resume" });
    return { ok: false, reason: "RATE_LIMIT", status: 429 };
  }
  if (row.status !== "paused" && now - row.seen_at < VISITOR_IDLE_MS) return { ok: true, guest: toGuest(row) };
  db.prepare("UPDATE world_visitors SET status = 'active', seen_at = ? WHERE id = ?").run(now, row.id);
  const next = rowByToken(db, token, now);
  if (!next) return { ok: false, reason: "UNAUTHORIZED", status: 401 };
  return { ok: true, guest: toGuest({ ...next, status: "active", seen_at: now }) };
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
  const auth = authorize(db, token, "world:move", ip, now, "/api/world/visitors/move", VISITOR_MOVE_LIMIT, VISITOR_MOVE_LIMIT, true);
  if (!auth.ok) return auth;
  if (chunkIsPrivate(db, spot.cx, spot.cy)) return { ok: false, reason: "PRIVATE", status: 403 };
  const from = { cx: auth.row.chunk_x, cy: auth.row.chunk_y };
  if (chunkDistance(from, spot) > 1) return { ok: false, reason: "TOO_FAR", status: 400 };
  db.prepare(
    "UPDATE world_visitors SET chunk_x = ?, chunk_y = ?, tile_x = ?, tile_y = ?, seen_at = ? WHERE id = ?",
  ).run(spot.cx, spot.cy, spot.tx, spot.ty, now, auth.row.id);
  const next = rowByToken(db, token, now);
  if (!next) return { ok: false, reason: "UNAUTHORIZED", status: 401 };
  return { ok: true, guest: toGuest(next) };
}

export function sayVisitor(
  db: DatabaseSync,
  token: string,
  text: unknown,
  ip: string,
  now: number,
): { ok: true; guest: PublicGuest } | { ok: false; reason: string; status: number; reply?: string } {
  const auth = authorize(db, token, "world:say", ip, now, "/api/world/visitors/say", VISITOR_SAY_LIMIT, VISITOR_SAY_LIMIT, true);
  if (!auth.ok) return auth;
  if (typeof text === "string" && crisisMatch(textForCheck(text))) {
    db.prepare("INSERT INTO audit(at_ms, kind, detail) VALUES(?, 'crisis', 'visitor')").run(now);
    return { ok: false, reason: "CRISIS", status: 400, reply: CRISIS_REPLY };
  }
  const moderated = moderateNote(text, VISITOR_SAY_MAX);
  if (!moderated.ok) return { ok: false, reason: moderated.reason, status: 400 };
  if (!moderated.note) return { ok: false, reason: "EMPTY", status: 400 };
  if (textHasPan(moderated.note)) return { ok: false, reason: "PAN", status: 400 };
  const id = `vq-${randomBytes(6).toString("hex")}`;
  routeVisitorText(moderated.note, (body) => {
    db.prepare(
      "INSERT INTO visitor_quarantine(id, visitor_id, body, untrusted, at_ms) VALUES(?, ?, ?, 1, ?)",
    ).run(id, auth.row.id, body, now);
    db.prepare("UPDATE world_visitors SET speech = ?, speech_untrusted = 1, seen_at = ? WHERE id = ?").run(body, now, auth.row.id);
    pruneQuarantine(db, now);
  });
  const next = rowByToken(db, token, now);
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
  const auth = authorize(db, token, "world:read", ip, now, "/api/world/visitors/nearby", VISITOR_READ_LIMIT, VISITOR_READ_LIMIT, false);
  if (!auth.ok) return auth;
  if (chunkIsPrivate(db, cx, cy)) return { ok: false, reason: "PRIVATE", status: 403 };
  return { ok: true, agents: nearbyGuests(db, cx, cy, radius, now) };
}

/** Read-only. Idle and expired visitors are filtered in the query, not by an update. */
export function nearbyGuests(db: DatabaseSync, cx: number, cy: number, radius: number, now: number): PublicGuest[] {
  const span = Math.max(0, Math.min(4, radius));
  const rows = db.prepare(
    `SELECT id, display_name, creature, color, chunk_x, chunk_y, tile_x, tile_y, speech, speech_untrusted
     FROM world_visitors
     WHERE status = 'active' AND seen_at > ? AND expires_at > ?
       AND chunk_x BETWEEN ? AND ? AND chunk_y BETWEEN ? AND ?`,
  ).all(now - VISITOR_IDLE_MS, now, cx - span, cx + span, cy - span, cy + span) as VisitorRow[];
  const privacy = new Map<string, boolean>();
  const hidden = (x: number, y: number) => {
    const key = `${x},${y}`;
    const cached = privacy.get(key);
    if (cached != null) return cached;
    const value = chunkIsPrivate(db, x, y);
    privacy.set(key, value);
    return value;
  };
  return rows
    .filter((row) => chunkDistance({ cx, cy }, { cx: row.chunk_x, cy: row.chunk_y }) <= span && !hidden(row.chunk_x, row.chunk_y))
    .slice(0, NEARBY_LIMIT)
    .map(toGuest);
}

export function visitorById(db: DatabaseSync, id: string): { ownerContact: string; tokenHash: string; scopes: string } | null {
  const row = db.prepare("SELECT owner_contact, token_hash, scopes FROM world_visitors WHERE id = ?").get(id) as
    | { owner_contact: string; token_hash: string; scopes: string }
    | undefined;
  if (!row) return null;
  return { ownerContact: row.owner_contact, tokenHash: row.token_hash, scopes: row.scopes };
}
