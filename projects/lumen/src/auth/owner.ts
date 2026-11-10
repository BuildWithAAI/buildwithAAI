import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { clientAddress } from "./address";

export { clientAddress };

const LOGIN_WINDOW_MS = 15 * 60_000;

const SESSION_MS = 12 * 60 * 60 * 1000;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltHex, hashHex] = parts;
  if (!n || !r || !p || !saltHex || !hashHex) return false;
  const hash = scryptSync(password, Buffer.from(saltHex, "hex"), 32, { N: Number(n), r: Number(r), p: Number(p) });
  const expected = Buffer.from(hashHex, "hex");
  if (hash.length !== expected.length) return false;
  return timingSafeEqual(hash, expected);
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function ownerConfigured(env: Record<string, string | undefined>): boolean {
  return Boolean(env.OWNER_PASSWORD_HASH || env.OWNER_ACCESS_TOKEN) && Boolean(env.OWNER_SESSION_SECRET);
}

export function credentialsMatch(secret: string, env: Record<string, string | undefined>): boolean {
  if (env.OWNER_ACCESS_TOKEN && safeEqual(secret, env.OWNER_ACCESS_TOKEN)) return true;
  if (env.OWNER_PASSWORD_HASH && verifyPassword(secret, env.OWNER_PASSWORD_HASH)) return true;
  return false;
}

export function createSession(db: DatabaseSync, now: number): string {
  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  db.prepare("INSERT INTO sessions(token_hash, expires_at) VALUES(?, ?)").run(tokenHash, now + SESSION_MS);
  return token;
}

export function sessionValid(db: DatabaseSync, token: string | null, now: number): boolean {
  if (!token) return false;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const row = db.prepare("SELECT expires_at FROM sessions WHERE token_hash = ?").get(tokenHash) as { expires_at: number } | undefined;
  return Boolean(row && row.expires_at > now);
}

export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export const OWNER_COOKIE = "lumen_owner";

/** Wait grows after five failures from one address. There is no shared lockout across addresses. */
export function loginBackoffMs(failures: number): number {
  if (failures < 5) return 0;
  return Math.min(LOGIN_WINDOW_MS, 30_000 * 2 ** (failures - 5));
}

export function allowLogin(db: DatabaseSync, addressKey: string, now: number, limits = { perAddress: 8 }): boolean {
  const since = now - LOGIN_WINDOW_MS;
  const bucket = `login:ip:${addressKey}`;
  db.exec("BEGIN IMMEDIATE");
  try {
    const rows = db.prepare("SELECT at_ms FROM rate_limits WHERE bucket = ? AND at_ms >= ? ORDER BY at_ms ASC").all(bucket, since) as { at_ms: number }[];
    const last = rows.length ? Number(rows[rows.length - 1]!.at_ms) : 0;
    const wait = loginBackoffMs(rows.length);
    if (rows.length >= limits.perAddress || (wait > 0 && now - last < wait)) {
      db.exec("COMMIT");
      return false;
    }
    db.prepare("INSERT INTO rate_limits(bucket, at_ms) VALUES(?, ?)").run(bucket, now);
    db.exec("COMMIT");
    return true;
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* already closed */ }
    throw error;
  }
}
