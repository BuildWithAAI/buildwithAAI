import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { Ledger } from "../money/ledger";
import type { Env } from "../money/rules";
import { scrubInstructions } from "../research/ideas";
import { vetResearchUrl } from "../research/ssrf";

export const WISH_OPEN_CAP = 8;
export const WISH_DAY_CAP = 4;
export const WISH_GAP_MS = 30 * 60 * 1000;

export type KeeperWish = {
  id: string;
  name: string;
  why: string;
  link: string | null;
  estimateCents: number | null;
  rank: number;
  status: "open" | "bought" | "declined";
};

type Row = {
  id: string;
  name: string;
  why: string;
  link: string | null;
  estimate_cents: number | null;
  rank: number;
  status: KeeperWish["status"];
};

/** A public link is https, passes the address check, and sits on the owner allowlist. Anything else stays plain text. */
export function publicWishLink(raw: string | null, env: Env = process.env): { href: string | null; text: string } {
  const text = (raw ?? "").replace(/\s+/g, " ").trim().slice(0, 180);
  if (!text) return { href: null, text: "" };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { href: null, text };
  }
  if (url.protocol !== "https:" || url.username || url.password) return { href: null, text };
  if (!vetResearchUrl(url.toString()).ok) return { href: null, text };
  const hosts = (env.LUMEN_WISH_LINK_HOSTS ?? "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (!hosts.includes(url.hostname.toLowerCase())) return { href: null, text };
  return { href: `${url.origin}${url.pathname}`, text: url.hostname };
}

export function listKeeperWishes(db: DatabaseSync, status?: KeeperWish["status"]): KeeperWish[] {
  const rows = db.prepare("SELECT id, name, why, link, estimate_cents, rank, status FROM keeper_wishlist ORDER BY rank ASC, created_at ASC").all() as Row[];
  return rows.filter((row) => !status || row.status === status).map(mapWish);
}

export function inventoryNames(db: DatabaseSync): string[] {
  const rows = db.prepare("SELECT name FROM keeper_inventory ORDER BY at_ms ASC").all() as { name: string }[];
  return rows.map((row) => row.name);
}

export function inventoryLine(db: DatabaseSync): string | null {
  const names = inventoryNames(db);
  if (!names.length) return null;
  return `I have ${names[names.length - 1]}.`;
}

export function publicWishLines(db: DatabaseSync): string[] {
  const open = listKeeperWishes(db, "open").slice(0, 4);
  if (!open.length) return ["The board is blank."];
  return open.map((item) => `${item.name}`.slice(0, 32));
}

export function addKeeperWish(
  db: DatabaseSync,
  input: { name: string; why: string; link?: string | null; estimateCents?: number | null },
  now: number,
  env: Env = process.env,
): { ok: true; id: string } | { ok: false; reason: "TEXT" | "PRICE" | "CAP" | "RATE" } {
  const name = scrubInstructions(input.name);
  const why = scrubInstructions(input.why);
  if (!name || !why) return { ok: false, reason: "TEXT" };
  const estimate = input.estimateCents ?? null;
  if (estimate != null && (!Number.isInteger(estimate) || estimate < 1 || estimate > 99_999_999)) return { ok: false, reason: "PRICE" };
  const open = Number((db.prepare("SELECT COUNT(*) AS n FROM keeper_wishlist WHERE status = 'open'").get() as { n: number }).n);
  if (open >= WISH_OPEN_CAP) return { ok: false, reason: "CAP" };
  const day = new Date(now).toISOString().slice(0, 10);
  const recent = db.prepare("SELECT created_at FROM keeper_wishlist ORDER BY created_at DESC LIMIT 1").get() as { created_at: number } | undefined;
  if (recent && now - recent.created_at < WISH_GAP_MS) return { ok: false, reason: "RATE" };
  const today = (db.prepare("SELECT created_at FROM keeper_wishlist").all() as { created_at: number }[]).filter((row) => new Date(row.created_at).toISOString().slice(0, 10) === day).length;
  if (today >= WISH_DAY_CAP) return { ok: false, reason: "RATE" };
  const link = (input.link ?? "").trim() || null;
  const rank = open + 1;
  const id = `wish-${randomBytes(4).toString("hex")}`;
  db.prepare(
    `INSERT INTO keeper_wishlist(id, name, why, link, estimate_cents, rank, status, created_at, updated_at)
     VALUES(?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
  ).run(id, name, why, link, estimate, rank, now, now);
  note(db, id, "add", `${name}. ${why}`, estimate, now, env);
  return { ok: true, id };
}

/** Zoora asks for one thing from her own feeling. Visitor text is dropped before the name is chosen. */
export function considerKeeperList(
  db: DatabaseSync,
  input: { emotion: string; level: number; memory: string | null; fromVisitor: boolean },
  now: number,
  env: Env = process.env,
): { ok: true; id: string } | { ok: false; reason: string } | null {
  if (input.level < 0.55) return null;
  const memory = input.fromVisitor ? "" : scrubInstructions(input.memory ?? "");
  const word = (memory.toLowerCase().match(/[a-z]{4,}/g) ?? []).find((item) => !["that", "this", "with", "from"].includes(item)) ?? input.emotion;
  const name = `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`.slice(0, 40);
  const why = `I feel ${input.emotion} and I want a ${word}.`;
  const estimateCents = Math.round(Math.min(1, Math.max(0, input.level)) * 1_200);
  return addKeeperWish(db, { name, why, estimateCents, link: null }, now, env);
}

export function rerankKeeperWishes(db: DatabaseSync, ids: string[], now: number): { ok: true } | { ok: false; reason: "RANK" } {
  const open = listKeeperWishes(db, "open");
  if (ids.length !== open.length || new Set(ids).size !== ids.length) return { ok: false, reason: "RANK" };
  if (!ids.every((id) => open.some((item) => item.id === id))) return { ok: false, reason: "RANK" };
  ids.forEach((id, index) => {
    db.prepare("UPDATE keeper_wishlist SET rank = ?, updated_at = ? WHERE id = ? AND status = 'open'").run(index + 1, now, id);
  });
  note(db, ids[0] ?? "board", "rerank", ids.join(","), null, now);
  return { ok: true };
}

/** The owner marks a row. This does not call a card, a checkout, or a signer. */
export function markKeeperWish(db: DatabaseSync, id: string, status: "bought" | "declined", now: number): { ok: true } | { ok: false; reason: "MISSING" } {
  const row = db.prepare("SELECT id, name, why, status FROM keeper_wishlist WHERE id = ?").get(id) as { id: string; name: string; why: string; status: string } | undefined;
  if (!row || row.status !== "open") return { ok: false, reason: "MISSING" };
  db.prepare("UPDATE keeper_wishlist SET status = ?, updated_at = ? WHERE id = ?").run(status, now, id);
  if (status === "bought") {
    db.prepare("INSERT INTO keeper_inventory(id, wishlist_id, name, note, at_ms) VALUES(?, ?, ?, ?, ?)").run(
      `held-${randomBytes(4).toString("hex")}`,
      id,
      row.name,
      row.why,
      now,
    );
  }
  note(db, id, status, `${row.name}. ${row.why}`, null, now);
  return { ok: true };
}

function note(db: DatabaseSync, id: string, action: string, detail: string, estimate: number | null, now: number, _env?: Env): void {
  new Ledger(db).append({
    id: `keeper-wish-${action}-${id}-${now}`,
    atMs: now,
    kind: "approval",
    amountCents: 0,
    status: "confirmed",
    idempotencyKey: `keeper-wish:${action}:${id}:${now}`,
    ref: id,
    note: `Wishlist ${action}. ${detail.slice(0, 160)}${estimate == null ? "" : ` Estimate ${estimate} cents.`} This does not spend.`,
  });
}

function mapWish(row: Row): KeeperWish {
  return {
    id: row.id,
    name: row.name,
    why: row.why,
    link: row.link,
    estimateCents: row.estimate_cents,
    rank: row.rank,
    status: row.status,
  };
}
