import type { DatabaseSync } from "node:sqlite";
import { fenceUntrusted } from "../brain/prompt";
import { scrubInstructions } from "../research/ideas";

/**
 * Taint. Text from outside is assumed to be trying to steer her, and that is made not to matter.
 *
 * Anything that came from outside, or was made from something that did, carries a mark for good. A mark
 * is never removed by time, by rewording or by passing through her own thoughts. Money, trades and code
 * changes ask whether anything behind them is marked, and refuse if it is.
 *
 * Every new way text can reach her (a reply, a buyer's note, a shop message, another agent, a feed) comes
 * in through `intake`. That is the one door.
 */

export const SOURCES = ["visitor", "web", "telegram", "x", "shop", "buyer", "agent", "feed"] as const;
export type TaintSource = (typeof SOURCES)[number];
/** Kinds of stored thing a mark can sit on. */
export const KINDS = ["memory", "idea", "want", "proposal", "wish", "venture", "post"] as const;
export type TaintKind = (typeof KINDS)[number];

const REF = /^[A-Za-z0-9:_.-]{1,120}$/;

export function ensureTaint(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS taint_marks (
    kind TEXT NOT NULL, ref TEXT NOT NULL, source TEXT NOT NULL, at_ms INTEGER NOT NULL, via TEXT NOT NULL DEFAULT '',
    PRIMARY KEY(kind, ref)
  )`);
}

export type Intake = { text: string; fenced: string; source: TaintSource; tainted: true };

/** The one door for outside text. What comes back is scrubbed, fenced, and always marked. */
export function intake(raw: string, source: TaintSource, maxLength = 2_000): Intake {
  if (!(SOURCES as readonly string[]).includes(source)) throw new Error("TAINT_SOURCE");
  const visible = String(raw).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, " ").slice(0, maxLength);
  // A card number typed with spaces or dashes is still a card number.
  const text = scrubInstructions(visible.replace(/\b(?:\d[ -]?){12,18}\d\b/g, "[redacted-number]"));
  return { text, fenced: fenceUntrusted(source, text), source, tainted: true };
}

export function markTainted(db: DatabaseSync, kind: TaintKind, ref: string, source: TaintSource, now: number, via = ""): void {
  ensureTaint(db);
  if (!(KINDS as readonly string[]).includes(kind) || !(SOURCES as readonly string[]).includes(source) || !REF.test(ref)) throw new Error("TAINT_MARK");
  // The first mark stands. A later one does not overwrite where the taint first came from.
  db.prepare("INSERT OR IGNORE INTO taint_marks(kind, ref, source, at_ms, via) VALUES(?, ?, ?, ?, ?)").run(kind, ref, source, now, via.slice(0, 160));
}

export function taintOf(db: DatabaseSync, kind: TaintKind, ref: string): TaintSource | null {
  ensureTaint(db);
  const row = db.prepare("SELECT source FROM taint_marks WHERE kind = ? AND ref = ?").get(kind, ref) as { source: TaintSource } | undefined;
  return row?.source ?? null;
}

/** A thing made from marked things is marked. Returns the source it inherited, or null if every parent was clean. */
export function inheritTaint(db: DatabaseSync, parents: { kind: TaintKind; ref: string }[], child: { kind: TaintKind; ref: string }, now: number): TaintSource | null {
  for (const parent of parents) {
    const source = taintOf(db, parent.kind, parent.ref);
    if (source) {
      markTainted(db, child.kind, child.ref, source, now, `${parent.kind}:${parent.ref}`);
      return source;
    }
  }
  return null;
}

export type MoneyCheck = { ok: true } | { ok: false; reason: "TAINTED"; source: TaintSource; from: string };

/** Asked before money moves or code changes. One marked thing behind the request is enough to refuse it. */
export function untainted(db: DatabaseSync, behind: { kind: TaintKind; ref: string }[]): MoneyCheck {
  for (const item of behind) {
    const source = taintOf(db, item.kind, item.ref);
    if (source) return { ok: false, reason: "TAINTED", source, from: `${item.kind}:${item.ref}` };
  }
  return { ok: true };
}

/** A mark is not removed. This exists so a test can prove there is no way to remove one. */
export function taintCount(db: DatabaseSync): number {
  ensureTaint(db);
  return Number((db.prepare("SELECT COUNT(*) AS n FROM taint_marks").get() as { n: number }).n);
}
