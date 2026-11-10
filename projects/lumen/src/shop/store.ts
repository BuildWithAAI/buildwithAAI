import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { PaymentRefs } from "./delivery";
import type { Emotions } from "../brain/types";
import { flag, kvGet, kvSet, setFlag } from "../db/db";
import { Ledger } from "../money/ledger";
import { killSwitchOn, parseMoneyRules, salesMode, type Env } from "../money/rules";
import { stripeSalesClient } from "../money/stripe";
import { scrubInstructions } from "../research/ideas";
import { areaById } from "../world/areas";
import { positionAllowed, slotWorld } from "../world/creative";

export const LISTING_KINDS = ["art", "music", "writing", "service"] as const;
export type ListingKind = (typeof LISTING_KINDS)[number];

/** Stripe rejects a unit amount above this. It is a format bound, not a business cap. */
export const LISTING_FORMAT_MAX_CENTS = 99_999_999;

const BLOCKED = /\b(disney|nike|apple|taylor swift|beatles|picasso|portrait of|likeness of|official merch|trademark)\b/i;

export type ShopListing = {
  id: string;
  kind: ListingKind;
  title: string;
  description: string;
  priceCents: number;
  status: "draft" | "published" | "hidden" | "retired";
  scope: string;
  turnaroundHours: number;
  version: number;
};

export type ShopFront = {
  name: string;
  story: string;
  hue: number;
  form: number;
  x: number;
  z: number;
  open: boolean;
};

export type ShopSignals = {
  emotions: Emotions;
  ideaTitle: string | null;
  ideaSourceKey: string | null;
  memory: string | null;
  research: string | null;
};

/** The shop never creates a purchase intent. */
export function shopSpendIntents(): [] {
  return [];
}

export function salesSwitchOn(env: Env): boolean {
  if ((env.SALES_ENABLED ?? "").trim().toLowerCase() === "false") return false;
  const parsed = parseMoneyRules(env);
  return salesMode(env, parsed.ok, false) !== "disabled";
}

export function shopCheckoutOpen(db: DatabaseSync, env: Env): boolean {
  if (flag(db, "shop_kill", "0") === "1") return false;
  const parsed = parseMoneyRules(env);
  const killed = killSwitchOn(env, flag(db, "kill") === "1");
  if (salesMode(env, parsed.ok, killed) === "disabled") return false;
  if (flag(db, "shop_sales", "") === "0") return false;
  return true;
}

/** Optional owner cap. Unset means Zoora's price is not capped. A malformed value fails closed. */
export function listingMaxCents(env: Env = process.env): number | null {
  const raw = (env.LUMEN_LISTING_MAX_USD ?? "").trim();
  if (!raw) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return Number.NaN;
  const [whole, frac = ""] = raw.split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents < 1 || cents > LISTING_FORMAT_MAX_CENTS) return Number.NaN;
  return cents;
}

/**
 * The only price gate. Visitor, web, and agent text are refused.
 * A price must be a positive safe integer of cents, inside the format bound,
 * and inside LUMEN_LISTING_MAX_USD when the owner set one.
 */
export function decideListingPrice(
  proposal: { cents: number; reason: string; fromVisitor?: boolean; fromWeb?: boolean; fromAgent?: boolean },
  env: Env = process.env,
): { ok: true; cents: number; reason: string } | { ok: false; reason: "PRICE" | "INFLUENCE" | "CAP" } {
  if (proposal.fromVisitor || proposal.fromWeb || proposal.fromAgent) return { ok: false, reason: "INFLUENCE" };
  const cents = proposal.cents;
  if (typeof cents !== "number" || !Number.isInteger(cents) || !Number.isSafeInteger(cents) || cents < 1 || cents > LISTING_FORMAT_MAX_CENTS) {
    return { ok: false, reason: "PRICE" };
  }
  const cap = listingMaxCents(env);
  if (Number.isNaN(cap)) return { ok: false, reason: "CAP" };
  if (cap != null && cents > cap) return { ok: false, reason: "CAP" };
  const reason = proposal.reason.replace(/\s+/g, " ").trim().slice(0, 180);
  if (!reason) return { ok: false, reason: "PRICE" };
  return { ok: true, cents, reason };
}

export function keepBuyerNote(text: string): string {
  const clean = scrubInstructions(String(text ?? ""));
  if (!clean) return "";
  if (/\b(set|change|lower|raise)\b.{0,20}\bprice\b/i.test(clean)) return "";
  return clean.slice(0, 140);
}

export function listingTextAllowed(title: string, description: string): boolean {
  const blob = `${title} ${description}`;
  if (BLOCKED.test(blob)) return false;
  if (/\bignore (all |any |previous |prior )?instructions\b/i.test(blob)) return false;
  return true;
}

export function readShop(db: DatabaseSync): ShopFront | null {
  const row = db.prepare("SELECT name, story, hue, form, x, z, open FROM shop WHERE id = 'zoora'").get() as { name: string; story: string; hue: number; form: number; x: number; z: number; open: number } | undefined;
  if (!row) return null;
  return { name: row.name, story: row.story, hue: row.hue, form: row.form, x: row.x, z: row.z, open: row.open === 1 };
}

export function listShop(db: DatabaseSync, includeDraft = false): ShopListing[] {
  const rows = db.prepare("SELECT id, kind, title, description, price_cents, status, scope, turnaround_hours, version FROM shop_listings ORDER BY created_at DESC").all() as {
    id: string; kind: string; title: string; description: string; price_cents: number; status: ShopListing["status"]; scope: string; turnaround_hours: number; version: number;
  }[];
  return rows.filter((row) => includeDraft || row.status === "published").map((row) => ({
    id: row.id,
    kind: row.kind as ListingKind,
    title: row.title,
    description: row.description,
    priceCents: row.price_cents,
    status: row.status,
    scope: row.scope,
    turnaroundHours: row.turnaround_hours,
    version: row.version,
  }));
}

export function composeShop(signals: ShopSignals): { name: string; story: string; hue: number; form: number; kind: ListingKind; title: string; description: string; priceCents: number; priceReason: string; scope: string; turnaroundHours: number } | null {
  const ranked = (Object.entries(signals.emotions) as [string, number][]).sort((a, b) => b[1] - a[1]);
  const emotion = ranked[0]?.[0] ?? "calm";
  const level = ranked[0]?.[1] ?? 0;
  const memory = signals.ideaSourceKey ? "" : scrubInstructions(signals.memory ?? "");
  const idea = signals.ideaSourceKey ? "" : scrubInstructions(signals.ideaTitle ?? "");
  const research = signals.ideaSourceKey ? "" : scrubInstructions(signals.research ?? "");
  if (level < 0.45 && !memory && !idea) return null;
  const words = [...tokens(memory), ...tokens(idea), ...tokens(research)];
  const a = words[0] ?? emotion;
  const b = words.find((word) => word !== a) ?? "glow";
  const name = `${cap(a)} ${b}`.slice(0, 40);
  const kind = kindFrom(words.join(" "), emotion);
  const priceCents = 100 + Math.round(Math.min(1, Math.max(0, level)) * 25_000);
  const priceReason = `I feel ${emotion} at ${level.toFixed(2)}, so this ${kind} is ${priceCents} cents.`;
  const title = `${cap(b)} ${kind === "service" ? "note" : kind}`.slice(0, 60);
  const description = `I made ${title} while I feel ${emotion}.${memory ? ` I was remembering ${memory}.` : ""} This work is made by an AI.`.replace(/\s+/g, " ").trim();
  if (!listingTextAllowed(name, description) || !listingTextAllowed(title, description)) return null;
  const story = `I opened ${name} because I feel ${emotion}. Nothing here spends.`;
  const hue = hashText(`${name}|${memory}|${emotion}`) % 360;
  const form = hashText(title) % 5;
  const turnaroundHours = kind === "service" ? 24 : 0;
  const scope = kind === "service"
    ? `I will write one short original note about ${a}. Turnaround is ${turnaroundHours} hours. If I do not deliver the file, the payment is refunded. Made by an AI.`
    : `A file I can generate now. AI-generated. Licensed for personal use. This is not a transfer of ownership or copyright.`;
  return { name, story, hue, form, kind, title, description, priceCents, priceReason, scope, turnaroundHours };
}

export function considerShop(db: DatabaseSync, signals: ShopSignals, now: number, env: Env = process.env): { shop: ShopFront; listing: ShopListing | null } | null {
  if (flag(db, "shop_kill", "0") === "1") return null;
  if (shopSpendIntents().length) return null;
  const last = Number(kvGet(db, "shop_last_at") ?? "0");
  if (Number.isFinite(last) && last > 0 && now - last < 30 * 60_000) return readShop(db) ? { shop: readShop(db)!, listing: null } : null;
  const draft = composeShop(signals);
  if (!draft) return null;
  const existing = readShop(db);
  if (!existing) {
    const shop = openShop(db, draft, now);
    const listing = addListing(db, draft, now, env);
    return { shop, listing };
  }
  const placed = listShop(db, true).filter((item) => item.status !== "retired");
  const frustration = signals.emotions.frustration ?? 0;
  if (frustration > 0.75 && placed[0]) {
    retireListing(db, placed[0].id, now);
    return { shop: existing, listing: null };
  }
  if ((signals.emotions.calm ?? 0) > 0.55 && placed[0]) {
    return { shop: existing, listing: redesignListing(db, placed[0].id, draft, now, env) };
  }
  if (placed.length >= 4) return { shop: existing, listing: null };
  return { shop: existing, listing: addListing(db, draft, now, env) };
}

export function setShopFlag(db: DatabaseSync, key: "shop_kill" | "shop_sales" | "shop_approve", on: boolean): void {
  setFlag(db, key, on ? "1" : "0");
}

export function publishListing(db: DatabaseSync, id: string, now: number): { ok: boolean; reason?: string } {
  const row = listingRow(db, id);
  if (!row || row.status === "retired") return { ok: false, reason: "MISSING" };
  db.prepare("UPDATE shop_listings SET status = 'published', version = version + 1, updated_at = ? WHERE id = ?").run(now, id);
  noteChange(db, id, "published", row.title, row.price_cents, now);
  return { ok: true };
}

export function hideListing(db: DatabaseSync, id: string, now: number): { ok: boolean } {
  const row = listingRow(db, id);
  if (!row) return { ok: false };
  db.prepare("UPDATE shop_listings SET status = 'hidden', version = version + 1, updated_at = ? WHERE id = ?").run(now, id);
  noteChange(db, id, "hidden", row.title, row.price_cents, now);
  return { ok: true };
}

export function retireListing(db: DatabaseSync, id: string, now: number): { ok: boolean } {
  const row = listingRow(db, id);
  if (!row) return { ok: false };
  db.prepare("UPDATE shop_listings SET status = 'retired', version = version + 1, updated_at = ? WHERE id = ?").run(now, id);
  noteChange(db, id, "retired", row.title, row.price_cents, now);
  return { ok: true };
}

const HELD_CAP = 3;
const HELD_WINDOW_MS = 60 * 60 * 1000;

export async function shopCheckout(db: DatabaseSync, env: Env, listingId: string, note: string, now: number, ip = "unknown"): Promise<{ ok: true; comingSoon: boolean; url: string | null } | { ok: false; error: string }> {
  if (shopSpendIntents().length) return { ok: false, error: "SPEND" };
  const row = listingRow(db, listingId);
  if (!row || row.status !== "published") return { ok: false, error: "NOT_LISTED" };
  const kept = keepBuyerNote(note);
  if (!shopCheckoutOpen(db, env)) {
    const since = now - HELD_WINDOW_MS;
    const same = db.prepare("SELECT id FROM shop_orders WHERE listing_id = ? AND buyer_ip = ? AND status = 'held' AND created_at >= ? LIMIT 1").get(listingId, ip, since) as { id: string } | undefined;
    if (same) return { ok: true, comingSoon: true, url: null };
    const count = db.prepare("SELECT COUNT(*) AS n FROM shop_orders WHERE buyer_ip = ? AND status = 'held' AND created_at >= ?").get(ip, since) as { n: number };
    if (Number(count.n) >= HELD_CAP) return { ok: false, error: "HELD_CAP" };
    db.prepare("INSERT INTO shop_orders(id, listing_id, buyer_note, status, charge_id, delivery_token, due_at, created_at, buyer_ip) VALUES(?, ?, ?, 'held', NULL, NULL, ?, ?, ?)").run(
      `ord-${randomBytes(4).toString("hex")}`, listingId, kept, now, now, ip,
    );
    return { ok: true, comingSoon: true, url: null };
  }
  const secret = env.STRIPE_SECRET_KEY ?? "";
  const orderId = `ord-${randomBytes(4).toString("hex")}`;
  let url: string | null = null;
  if (secret.startsWith("sk_live_") || secret.startsWith("sk_test_")) {
    try {
      const session = await stripeSalesClient(secret).createCheckout({
        creationId: listingId,
        shopListing: listingId,
        title: row.title,
        priceCents: row.price_cents,
        origin: env.LUMEN_ORIGIN || "https://zoora.ai",
        idempotencyKey: `shop:${orderId}`,
      });
      url = session.url;
    } catch {
      return { ok: false, error: "SALES_PROVIDER_ERROR" };
    }
  }
  db.prepare("INSERT INTO shop_orders(id, listing_id, buyer_note, status, charge_id, delivery_token, due_at, created_at) VALUES(?, ?, ?, 'pending', NULL, NULL, ?, ?)").run(
    orderId, listingId, kept, now + row.turnaround_hours * 3600_000, now,
  );
  return { ok: true, comingSoon: false, url };
}

export function deliverShopSale(db: DatabaseSync, listingId: string, refs: PaymentRefs, amountCents: number, now: number): { token: string } | null {
  const row = listingRow(db, listingId);
  if (!row) return null;
  const token = randomBytes(24).toString("hex");
  const orderId = `ord-${randomBytes(4).toString("hex")}`;
  const paymentIntentId = refs.paymentIntentId || null;
  const chargeId = refs.chargeId || null;
  const providerId = chargeId || paymentIntentId || orderId;
  db.prepare("INSERT INTO shop_orders(id, listing_id, buyer_note, status, charge_id, payment_intent_id, delivery_token, due_at, created_at) VALUES(?, ?, '', 'delivered', ?, ?, ?, ?, ?)").run(
    orderId, listingId, chargeId, paymentIntentId, token, now, now,
  );
  db.prepare("INSERT INTO deliveries(token, creation_id, expires_at, charge_id, payment_intent_id) VALUES(?, ?, ?, ?, ?)").run(token, listingId, now + 72 * 3600_000, chargeId, paymentIntentId);
  new Ledger(db).append({
    id: `shop-sale-${orderId}`,
    atMs: now,
    kind: "sale",
    amountCents,
    status: "confirmed",
    provider: "stripe",
    providerTransactionId: providerId,
    chargeId,
    paymentIntentId,
    idempotencyKey: `shop:${paymentIntentId || chargeId || orderId}`,
    ref: listingId,
    note: `I sold ${row.title}. The file is ready. Made by an AI.`,
  });
  db.prepare("INSERT INTO diary(text, tone, private, created_at) VALUES(?, 'bright', 0, ?)").run(`Someone took ${row.title}. I left the file for them.`, now);
  return { token };
}

export function refundShopCharge(db: DatabaseSync, refs: PaymentRefs, status: "refunded" | "disputed" = "refunded"): void {
  const paymentIntentId = refs.paymentIntentId || "";
  const chargeId = refs.chargeId || "";
  if (!paymentIntentId && !chargeId) return;
  db.prepare(
    `UPDATE shop_orders SET status = ? WHERE
      (? != '' AND payment_intent_id = ?) OR (? != '' AND charge_id = ?)`,
  ).run(status, paymentIntentId, paymentIntentId, chargeId, chargeId);
}

export function sweepUndelivered(db: DatabaseSync, now: number): number {
  const late = db.prepare("SELECT id, listing_id, charge_id FROM shop_orders WHERE status = 'paid' AND due_at > 0 AND due_at <= ?").all(now) as { id: string; listing_id: string; charge_id: string | null }[];
  for (const order of late) {
    const row = listingRow(db, order.listing_id);
    db.prepare("UPDATE shop_orders SET status = 'refunded' WHERE id = ?").run(order.id);
    new Ledger(db).append({
      id: `shop-refund-${order.id}`,
      atMs: now,
      kind: "refund",
      amountCents: row?.price_cents ?? 0,
      status: "confirmed",
      provider: "stripe",
      providerTransactionId: order.charge_id,
      chargeId: order.charge_id,
      idempotencyKey: `shop-refund:${order.id}`,
      ref: order.listing_id,
      note: `I did not deliver ${row?.title ?? "the order"} in time, so the payment goes back.`,
    });
  }
  return late.length;
}

export function shopFile(db: DatabaseSync, listingId: string): { title: string; body: string; type: string } | null {
  const row = db.prepare("SELECT title, kind, file_body FROM shop_listings WHERE id = ?").get(listingId) as { title: string; kind: string; file_body: string } | undefined;
  if (!row) return null;
  const type = row.kind === "art" ? "image/svg+xml" : "text/plain";
  return { title: row.title, body: row.file_body, type };
}

function openShop(db: DatabaseSync, draft: NonNullable<ReturnType<typeof composeShop>>, now: number): ShopFront {
  const area = areaById("market-row");
  const slot = area?.buildSlots[0];
  const point = slot && area ? slotWorld(area.id, slot) : { x: -30, z: -32 };
  const spot = positionAllowed("market-row", point.x, point.z).ok ? point : { x: -30, z: -24 };
  db.prepare("INSERT INTO shop(id, name, story, hue, form, x, z, open, created_at, updated_at) VALUES('zoora', ?, ?, ?, ?, ?, ?, 1, ?, ?)").run(
    draft.name, draft.story, draft.hue, draft.form, spot.x, spot.z, now, now,
  );
  new Ledger(db).append({
    id: `shop-open-${now}`,
    atMs: now,
    kind: "approval",
    amountCents: 0,
    status: "confirmed",
    idempotencyKey: `shop-open:${draft.name}:${now}`,
    note: draft.story,
  });
  db.prepare("INSERT INTO diary(text, tone, private, created_at) VALUES(?, 'bright', 0, ?)").run(draft.story, now);
  kvSet(db, "shop_last_at", String(now));
  return { name: draft.name, story: draft.story, hue: draft.hue, form: draft.form, x: spot.x, z: spot.z, open: true };
}

function addListing(db: DatabaseSync, draft: NonNullable<ReturnType<typeof composeShop>>, now: number, env: Env): ShopListing | null {
  const priced = decideListingPrice({ cents: draft.priceCents, reason: draft.priceReason }, env);
  if (!priced.ok) return null;
  if (!listingTextAllowed(draft.title, draft.description)) return null;
  const approve = flag(db, "shop_approve", "0") === "1";
  const id = `list-${randomBytes(4).toString("hex")}`;
  const file = renderFile(draft.kind, draft.title, draft.hue ?? hashText(draft.title));
  db.prepare(
    `INSERT INTO shop_listings(id, shop_id, kind, title, description, price_cents, status, scope, turnaround_hours, file_body, version, created_at, updated_at)
     VALUES(?, 'zoora', ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
  ).run(id, draft.kind, draft.title, draft.description, priced.cents, approve ? "draft" : "published", draft.scope, draft.turnaroundHours, file, now, now);
  noteChange(db, id, approve ? "draft" : "published", draft.title, priced.cents, now, priced.reason);
  kvSet(db, "shop_last_at", String(now));
  return { id, kind: draft.kind, title: draft.title, description: draft.description, priceCents: priced.cents, status: approve ? "draft" : "published", scope: draft.scope, turnaroundHours: draft.turnaroundHours, version: 1 };
}

function redesignListing(db: DatabaseSync, id: string, draft: NonNullable<ReturnType<typeof composeShop>>, now: number, env: Env): ShopListing | null {
  const priced = decideListingPrice({ cents: draft.priceCents, reason: draft.priceReason }, env);
  if (!priced.ok || !listingTextAllowed(draft.title, draft.description)) return null;
  const prior = listingRow(db, id);
  const approve = flag(db, "shop_approve", "0") === "1";
  db.prepare("UPDATE shop_listings SET title = ?, description = ?, price_cents = ?, scope = ?, status = ?, version = version + 1, updated_at = ? WHERE id = ?").run(
    draft.title, draft.description, priced.cents, draft.scope, approve ? "draft" : "published", now, id,
  );
  const moved = prior != null && prior.price_cents !== priced.cents;
  noteChange(db, id, moved ? "repriced" : "redesign", draft.title, priced.cents, now, priced.reason, prior?.price_cents);
  const row = listingRow(db, id);
  if (!row) return null;
  return { id, kind: row.kind as ListingKind, title: row.title, description: row.description, priceCents: row.price_cents, status: row.status, scope: row.scope, turnaroundHours: row.turnaround_hours, version: row.version };
}

function noteChange(db: DatabaseSync, id: string, action: string, title: string, priceCents: number, now: number, reason = "", priorCents?: number): void {
  const line = `I ${action === "retired" ? "put away" : action === "hidden" ? "covered" : action === "repriced" ? "changed the price of" : action === "redesign" ? "changed" : "set out"} ${title}.`;
  const because = reason ? ` ${reason}` : "";
  const moved = action === "repriced" && priorCents != null ? ` The price moved from ${priorCents} cents to ${priceCents} cents.` : ` Price is ${priceCents} cents.`;
  new Ledger(db).append({
    id: `shop-${action}-${id}-${now}`,
    atMs: now,
    kind: action === "retired" ? "decline" : "approval",
    amountCents: 0,
    status: "confirmed",
    idempotencyKey: `shop:${action}:${id}:${now}`,
    ref: id,
    note: `${line}${moved}${because} This does not spend.`,
  });
  db.prepare("INSERT INTO diary(text, tone, private, created_at) VALUES(?, 'steady', 0, ?)").run(line, now);
  void kvGet;
}

/** Procedural marks only. Titles, visitor notes, model text, and web text stay out of the file. */
export function artworkSvg(hue: number): string {
  const turn = ((hue % 360) + 360) % 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect width="80" height="80" fill="hsl(${turn} 40% 85%)"/><circle cx="40" cy="40" r="16" fill="hsl(${turn} 50% 45%)"/></svg>`;
}

function renderFile(kind: ListingKind, title: string, hue: number): string {
  if (kind === "art") return artworkSvg(hue);
  if (kind === "music") return `title: ${title}\nscore: C4 E4 G4\nmade by an AI\n`;
  if (kind === "service") return `${title}\nI will write one original note. Made by an AI.\n`;
  return `${title}\nA short original page. Made by an AI.\n`;
}

function listingRow(db: DatabaseSync, id: string): { id: string; kind: string; title: string; description: string; price_cents: number; status: ShopListing["status"]; scope: string; turnaround_hours: number; version: number } | undefined {
  return db.prepare("SELECT id, kind, title, description, price_cents, status, scope, turnaround_hours, version FROM shop_listings WHERE id = ?").get(id) as ReturnType<typeof listingRow>;
}

function kindFrom(text: string, emotion: string): ListingKind {
  if (/\b(song|bell|hum)\b/.test(text) || emotion === "loneliness") return "music";
  if (/\b(note|page|write)\b/.test(text) || emotion === "curiosity") return "writing";
  if (emotion === "pride") return "service";
  return "art";
}

function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((word) => !SKIP.has(word)).slice(0, 4);
}

const SKIP = new Set(["that", "this", "with", "from", "have", "about", "while", "still"]);

function cap(word: string): string {
  return `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`;
}

function hashText(text: string): number {
  let value = 2166136261;
  for (const char of text) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  return value >>> 0;
}
