import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { PurchaseIntent } from "../brain/types";
import { deskNotifier } from "./notify";
import { Ledger } from "./ledger";
import { killSwitchOn, type Env } from "./rules";
import { flag } from "../db/db";

export const CLAIM_MS = 30 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;
const PAN_KEY = /^(pan|cvc|cvv|card_number|cardnumber|full_number|card)$/i;
const AMAZON_ORDER = /^\d{3}-\d{7}-\d{7}$/;

export type CheckoutItem = {
  id: string;
  intentId: string;
  merchant: string;
  maxCents: number;
  status: string;
  expiresAt: number;
};

/** Refuse a body that tries to carry a card number. The queue has no card fields. */
export function rejectPan(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (PAN_KEY.test(key)) return true;
    if (typeof item === "number" && Number.isSafeInteger(item) && looksLikePan(String(item))) return true;
    if (typeof item === "string" && looksLikePan(item)) return true;
    if (item && typeof item === "object" && rejectPan(item)) return true;
  }
  return false;
}

function luhnOk(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let n = digits.charCodeAt(i) - 48;
    if (n < 0 || n > 9) return false;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

const CARD_JOIN = /[.\-_/·,:–—|]|\p{Cf}/gu;
const AMAZON_ANYWHERE = /\d{3}-\d{7}-\d{7}/g;

function foldIndicDigits(value: string): string {
  return value.replace(/[\u0660-\u0669\u06f0-\u06f9]/g, (char) => {
    const code = char.charCodeAt(0);
    const base = code >= 0x06f0 ? 0x06f0 : 0x0660;
    return String.fromCharCode(48 + code - base);
  });
}

/** USPS and FedEx SmartPost are 20/22 digits starting with 9. FedEx Ground here is 15 digits starting with 96. */
function trackingDigits(digits: string): boolean {
  if ((digits.length === 20 || digits.length === 22) && digits.startsWith("9")) return true;
  return digits.length === 15 && digits.startsWith("96");
}

/** UPS 1Z is 18 characters. A Luhn-valid card parked after 1Z is not a tracking number. */
function upsTracking(compact: string): boolean {
  const match = /^1Z([0-9A-Z]{16})$/i.exec(compact);
  if (!match) return false;
  const tail = match[1] ?? "";
  return !(/^\d{16}$/.test(tail) && luhnOk(tail));
}

function trackingToken(token: string): boolean {
  const compact = token.replace(/[\s-]/g, "");
  if (upsTracking(compact)) return true;
  const digits = compact.replace(/\D/g, "");
  return digits === compact && trackingDigits(digits);
}

/** USPS Mod 10. The rightmost data digit has weight 3, and the last digit is the check. */
function uspsMod10(digits: string): boolean {
  if (!((digits.length === 20 || digits.length === 22) && digits.startsWith("9"))) return false;
  let sum = 0;
  for (let i = digits.length - 2, weight = 3; i >= 0; i -= 1, weight = weight === 3 ? 1 : 3) {
    sum += (digits.charCodeAt(i) - 48) * weight;
  }
  return (10 - (sum % 10)) % 10 === digits.charCodeAt(digits.length - 1) - 48;
}

function knownIin(digits: string): boolean {
  if (digits.startsWith("4")) return true;
  const two = Number(digits.slice(0, 2));
  const three = Number(digits.slice(0, 3));
  const four = Number(digits.slice(0, 4));
  if (two >= 51 && two <= 55) return true;
  if (four >= 2221 && four <= 2720) return true;
  if (two === 34 || two === 37) return true;
  if (digits.startsWith("6011") || two === 65) return true;
  if (three >= 644 && three <= 649) return true;
  if (two === 35) return true;
  if (two === 30 || two === 36 || two === 38) return true;
  return false;
}

function cardWindow(window: string): boolean {
  return window.length >= 13 && window.length <= 19 && knownIin(window) && luhnOk(window);
}

/** A 9… number of 20 or 22 digits hides a card unless the whole number is a real USPS check. */
function nineTrackingCard(digits: string): boolean {
  if (!((digits.length === 20 || digits.length === 22) && digits.startsWith("9"))) return false;
  if (uspsMod10(digits)) return false;
  for (let length = 13; length <= 19; length += 1) {
    for (let start = 0; start + length <= digits.length; start += 1) {
      if (cardWindow(digits.slice(start, start + length))) return true;
    }
  }
  return false;
}

function joinSingleLetters(value: string): string {
  return value.replace(/(\d)[A-Za-z](?=\d)/g, "$1");
}

function edgeCard(digits: string): boolean {
  for (let length = 13; length <= 19; length += 1) {
    if (length >= digits.length) continue;
    const head = digits.slice(0, length);
    const tail = digits.slice(digits.length - length);
    if (cardWindow(head) || cardWindow(tail)) return true;
  }
  return false;
}

function luhnWindow(digits: string): boolean {
  if (digits.length === 15 && digits.startsWith("96")) return false;
  if (digits.length >= 13 && digits.length <= 19) {
    if (luhnOk(digits)) return true;
    return edgeCard(digits);
  }
  if ((digits.length === 20 || digits.length === 22) && digits.startsWith("9")) return nineTrackingCard(digits);
  if (digits.length >= 20 && digits.length <= 22) return edgeCard(digits);
  if (digits.length > 22) {
    for (let length = 13; length <= 19; length += 1) {
      for (let start = 0; start + length <= digits.length; start += 1) {
        if (luhnOk(digits.slice(start, start + length))) return true;
      }
    }
  }
  return false;
}

function looksLikePan(value: string): boolean {
  const normalized = foldIndicDigits(value.normalize("NFKC")).trim();
  if (AMAZON_ORDER.test(normalized)) return false;
  const compact = normalized.replace(/[\s-]/g, "");
  if (upsTracking(compact)) return false;
  const oneZCard = /^1Z(\d{16})$/i.exec(compact);
  if (oneZCard?.[1] && luhnOk(oneZCard[1])) return true;
  const withoutAmazon = normalized.replace(AMAZON_ANYWHERE, " ");
  CARD_JOIN.lastIndex = 0;
  const flattened = joinSingleLetters(withoutAmazon.replace(CARD_JOIN, ""));
  const flatCompact = flattened.replace(/\s+/g, "");
  if (/^\d+$/.test(flatCompact) && flatCompact.length === 15 && flatCompact.startsWith("96")) return false;
  if (/^\d+$/.test(flatCompact) && (flatCompact.length === 20 || flatCompact.length === 22) && flatCompact.startsWith("9")) {
    return nineTrackingCard(flatCompact);
  }
  const chunks = flattened.split(/\s+/).filter(Boolean);
  let groups: string[] = [];
  let found = false;
  const takeGroups = () => {
    if (!groups.length) return;
    for (const group of groups) {
      if (group.length >= 13 && group.length <= 19 && luhnOk(group)) found = true;
    }
    const joined = groups.join("");
    if (joined.length === 15 && joined.startsWith("96")) {
      groups = [];
      return;
    }
    if ((joined.length === 20 || joined.length === 22) && joined.startsWith("9")) {
      if (nineTrackingCard(joined)) found = true;
    } else if (groups.length === 1) {
      if (luhnWindow(joined)) found = true;
    } else if (joined.length >= 20 && joined.length <= 22) {
      if (edgeCard(joined)) found = true;
    } else if (luhnWindow(joined)) found = true;
    groups = [];
  };
  for (const chunk of chunks) {
    if (trackingToken(chunk) && !(chunk.replace(/\D/g, "").length >= 20 && chunk.replace(/\D/g, "").startsWith("9"))) {
      takeGroups();
      continue;
    }
    if (/^\d+$/.test(chunk)) {
      groups.push(chunk);
      continue;
    }
    takeGroups();
    for (const run of chunk.match(/\d+/g) ?? []) {
      if (luhnWindow(run)) found = true;
    }
  }
  takeGroups();
  return found;
}

export function enqueueCheckout(db: DatabaseSync, env: Env, intent: PurchaseIntent, now: number): { ok: true; id: string } | { ok: false; reason: string } {
  if (killSwitchOn(env, flag(db, "kill") === "1")) return { ok: false, reason: "KILL_SWITCH" };
  const id = `chk-${randomBytes(4).toString("hex")}`;
  db.prepare(
    `INSERT INTO checkout_queue(id, intent_id, merchant, max_cents, status, claim_token, claimed_at, expires_at, order_number, charged_cents, receipt, created_at)
     VALUES(?, ?, ?, ?, 'pending', NULL, NULL, ?, NULL, NULL, NULL, ?)`,
  ).run(id, intent.id, intent.merchant, intent.amountCents, now + DAY, now);
  return { ok: true, id };
}

export function listPending(db: DatabaseSync, now: number): CheckoutItem[] {
  expireClaims(db, now);
  const rows = db.prepare("SELECT id, intent_id, merchant, max_cents, status, expires_at FROM checkout_queue WHERE status = 'pending' AND expires_at > ? ORDER BY created_at ASC").all(now) as {
    id: string; intent_id: string; merchant: string; max_cents: number; status: string; expires_at: number;
  }[];
  return rows.map((row) => ({ id: row.id, intentId: row.intent_id, merchant: row.merchant, maxCents: row.max_cents, status: row.status, expiresAt: row.expires_at }));
}

export function claimCheckout(db: DatabaseSync, id: string, now: number): { ok: true; claimToken: string; item: CheckoutItem } | { ok: false; reason: string } {
  expireClaims(db, now);
  const row = db.prepare("SELECT id, intent_id, merchant, max_cents, status, expires_at FROM checkout_queue WHERE id = ?").get(id) as {
    id: string; intent_id: string; merchant: string; max_cents: number; status: string; expires_at: number;
  } | undefined;
  if (!row) return { ok: false, reason: "MISSING" };
  if (row.status !== "pending" || row.expires_at <= now) return { ok: false, reason: "CLAIMED" };
  const token = randomBytes(16).toString("hex");
  const changed = db.prepare("UPDATE checkout_queue SET status = 'claimed', claim_token = ?, claimed_at = ? WHERE id = ? AND status = 'pending'").run(token, now, id);
  if (Number(changed.changes) !== 1) return { ok: false, reason: "CLAIMED" };
  return { ok: true, claimToken: token, item: { id: row.id, intentId: row.intent_id, merchant: row.merchant, maxCents: row.max_cents, status: "claimed", expiresAt: row.expires_at } };
}

export function reportCheckout(db: DatabaseSync, input: { id: string; claimToken: string; ok: boolean; orderNumber?: string; amountCents?: number; merchant?: string; receipt?: string; reason?: string }, now: number): { ok: true } | { ok: false; reason: string } {
  if (rejectPan(input)) return { ok: false, reason: "PAN_REJECTED" };
  const row = db.prepare("SELECT id, intent_id, merchant, max_cents, status, claim_token FROM checkout_queue WHERE id = ?").get(input.id) as {
    id: string; intent_id: string; merchant: string; max_cents: number; status: string; claim_token: string | null;
  } | undefined;
  if (!row || row.status !== "claimed" || !row.claim_token || row.claim_token !== input.claimToken) return { ok: false, reason: "CLAIM" };
  const ledger = new Ledger(db);
  if (!input.ok) {
    ledger.append({
      id: `decline-${row.intent_id}`,
      atMs: now,
      kind: "decline",
      amountCents: 0,
      status: "declined",
      provider: "owner_checkout",
      providerTransactionId: null,
      idempotencyKey: `decline:${row.intent_id}`,
      ref: row.intent_id,
      note: `Checkout failed at ${row.merchant}. ${input.reason ?? "No charge."}`,
      merchant: row.merchant,
    });
    db.prepare("UPDATE checkout_queue SET status = 'failed' WHERE id = ?").run(row.id);
    db.prepare("UPDATE purchase_claims SET state = 'released' WHERE intent_id = ?").run(row.intent_id);
    return { ok: true };
  }
  const amount = input.amountCents;
  if (!Number.isInteger(amount) || amount == null || amount <= 0) return { ok: false, reason: "AMOUNT" };
  if (amount > row.max_cents) {
    deskNotifier(db).notify({ kind: "issuer", title: "Checkout report over the claim", detail: `${row.intent_id} reported ${amount} cents against a ${row.max_cents} cent claim.` });
    return { ok: false, reason: "OVER_CAP" };
  }
  if (!input.orderNumber || !input.merchant || !input.receipt) return { ok: false, reason: "REPORT" };
  if (input.merchant.trim() !== row.merchant) return { ok: false, reason: "MERCHANT" };
  const booked = ledger.append({
    id: `purchase-${row.intent_id}`,
    atMs: now,
    kind: "purchase",
    amountCents: amount,
    status: "confirmed",
    provider: "owner_checkout",
    providerTransactionId: input.receipt.slice(0, 80),
    idempotencyKey: `exec:${row.intent_id}`,
    ref: row.intent_id,
    note: `Owner checkout ${input.orderNumber} at ${row.merchant}.`,
    merchant: row.merchant,
  });
  db.prepare("UPDATE checkout_queue SET status = 'reported', order_number = ?, charged_cents = ?, receipt = ? WHERE id = ?").run(input.orderNumber.slice(0, 80), amount, input.receipt.slice(0, 80), row.id);
  db.prepare("UPDATE purchase_claims SET state = 'executed', ledger_id = ? WHERE intent_id = ?").run(booked.id, row.intent_id);
  return { ok: true };
}

export function expireClaims(db: DatabaseSync, now: number): number {
  const late = db.prepare("SELECT id, intent_id, merchant, max_cents FROM checkout_queue WHERE status = 'claimed' AND claimed_at IS NOT NULL AND claimed_at + ? <= ?").all(CLAIM_MS, now) as {
    id: string; intent_id: string; merchant: string; max_cents: number;
  }[];
  for (const row of late) {
    db.prepare("UPDATE checkout_queue SET status = 'unknown' WHERE id = ? AND status = 'claimed'").run(row.id);
    db.prepare("UPDATE purchase_claims SET state = 'unknown' WHERE intent_id = ?").run(row.intent_id);
    deskNotifier(db).notify({
      kind: "issuer",
      title: "Issuer outcome unknown",
      detail: `${row.intent_id} was claimed for ${row.max_cents} cents at ${row.merchant} and was not reported. Automatic spending stays paused.`,
    });
  }
  return late.length;
}
