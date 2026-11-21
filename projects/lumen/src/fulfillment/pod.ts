import type { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import { flag } from "../db/db";
import { getVenture, ventureLine, ventureSpendAllowed } from "../economy/ventures";
import { Ledger } from "../money/ledger";
import { deskNotifier } from "../money/notify";
import { readCheckoutSession, stripeSalesClient, type PaidSession, type SalesClient } from "../money/stripe";
import { artUrlAllowed, confirmOrder, createDraft, deleteDraft, getOrder, printfulConfigured, PrintfulError, type Recipient, type RemoteOrder } from "./printful";

/**
 * Print on demand: the rules around Printful.
 *
 * A product is one of Zoora's pictures on one blank. She proposes it, and the owner approves it after
 * looking at the art and saying it is her own work. Only an approved product can be ordered.
 *
 * An order goes: draft, priced, confirmed. A draft costs nothing. Once Printful has worked out the cost,
 * a paid order must leave a margin or it is refused and the draft deleted. Confirming is the step that
 * prints and charges. By default the owner confirms each one at the desk. The owner can switch on
 * confirming by herself, which then applies only to orders a customer has already paid for, in a
 * running venture with nothing from outside behind it. A sample is always the owner's call.
 *
 * If the network drops during a call, the order is marked "check" and read back from Printful before
 * anything is tried again, so one order is never created or confirmed twice.
 *
 * No address is stored here. It goes to Printful with the draft and stays there. For an order paid on
 * the site, the address is typed into Stripe's checkout, and is read from Stripe at the moment the draft
 * is opened.
 *
 * A paid order that cannot be printed (too little margin, a product since withdrawn, a printer that
 * cancels) raises an alert at the desk, where the owner sends the customer's money back.
 */

type Env = Record<string, string | undefined>;
export type ProductStatus = "proposed" | "approved" | "declined" | "retired";
export type OrderStatus = "paid" | "opening" | "draft" | "priced" | "confirming" | "confirmed" | "shipped" | "refused" | "failed" | "canceled" | "refunded" | "check";
export const DEFAULT_MIN_MARGIN_PERCENT = 20;
const IN_FLIGHT_MS = 120_000;
/** Printful's states for an order that was confirmed. */
const PRINTING = ["inreview", "pending", "inprocess", "onhold", "partial", "fulfilled"];
const ID = /^[a-z0-9-]{4,32}$/;
const WORD = /^[a-z0-9_-]{2,40}$/;
const PAID_REF = /^[A-Za-z0-9:_.-]{4,120}$/;

export function ensurePod(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pod_products (
      id TEXT PRIMARY KEY, venture_id TEXT NOT NULL, title TEXT NOT NULL, variant_id INTEGER NOT NULL,
      placement TEXT NOT NULL, technique TEXT NOT NULL, art_url TEXT NOT NULL, retail_cents INTEGER NOT NULL,
      status TEXT NOT NULL, created_at INTEGER NOT NULL, decided_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS pod_orders (
      id TEXT PRIMARY KEY, product_id TEXT NOT NULL, venture_id TEXT NOT NULL, quantity INTEGER NOT NULL,
      retail_cents INTEGER NOT NULL, paid_ref TEXT, printful_id INTEGER, status TEXT NOT NULL,
      cost_cents INTEGER, reason TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      payment_intent_id TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS pod_orders_paid ON pod_orders(paid_ref) WHERE paid_ref IS NOT NULL;
  `);
  // A database made before paid orders existed gains the column.
  const columns = db.prepare("PRAGMA table_info(pod_orders)").all() as { name: string }[];
  if (!columns.some((column) => column.name === "payment_intent_id")) db.exec("ALTER TABLE pod_orders ADD COLUMN payment_intent_id TEXT");
  db.exec("CREATE INDEX IF NOT EXISTS pod_orders_intent ON pod_orders(payment_intent_id)");
}

export type PodProduct = { id: string; ventureId: string; title: string; variantId: number; placement: string; technique: string; artUrl: string; retailCents: number; status: ProductStatus };
export type PodOrder = { id: string; productId: string; ventureId: string; quantity: number; retailCents: number; paidRef: string | null; printfulId: number | null; status: OrderStatus; costCents: number | null; reason: string; createdAt: number; updatedAt: number; paymentIntentId: string | null };

type ProductRow = { id: string; venture_id: string; title: string; variant_id: number; placement: string; technique: string; art_url: string; retail_cents: number; status: ProductStatus };
type OrderRow = { id: string; product_id: string; venture_id: string; quantity: number; retail_cents: number; paid_ref: string | null; printful_id: number | null; status: OrderStatus; cost_cents: number | null; reason: string; created_at: number; updated_at: number; payment_intent_id: string | null };

function product(row: ProductRow): PodProduct {
  return { id: row.id, ventureId: row.venture_id, title: row.title, variantId: Number(row.variant_id), placement: row.placement, technique: row.technique, artUrl: row.art_url, retailCents: Number(row.retail_cents), status: row.status };
}

function order(row: OrderRow): PodOrder {
  return { id: row.id, productId: row.product_id, ventureId: row.venture_id, quantity: Number(row.quantity), retailCents: Number(row.retail_cents), paidRef: row.paid_ref, printfulId: row.printful_id == null ? null : Number(row.printful_id), status: row.status, costCents: row.cost_cents == null ? null : Number(row.cost_cents), reason: row.reason, createdAt: Number(row.created_at), updatedAt: Number(row.updated_at), paymentIntentId: row.payment_intent_id };
}

export function getProduct(db: DatabaseSync, id: string): PodProduct | null {
  ensurePod(db);
  const row = db.prepare("SELECT * FROM pod_products WHERE id = ?").get(id) as ProductRow | undefined;
  return row ? product(row) : null;
}

export function listProducts(db: DatabaseSync): PodProduct[] {
  ensurePod(db);
  return (db.prepare("SELECT * FROM pod_products ORDER BY created_at DESC, id").all() as ProductRow[]).map(product);
}

export function getPodOrder(db: DatabaseSync, id: string): PodOrder | null {
  ensurePod(db);
  const row = db.prepare("SELECT * FROM pod_orders WHERE id = ?").get(id) as OrderRow | undefined;
  return row ? order(row) : null;
}

export function listPodOrders(db: DatabaseSync, limit = 50): PodOrder[] {
  ensurePod(db);
  return (db.prepare("SELECT * FROM pod_orders ORDER BY created_at DESC, id LIMIT ?").all(Math.min(200, Math.max(1, limit))) as OrderRow[]).map(order);
}

export type ProductInput = { id: string; ventureId: string; title: string; variantId: number; placement: string; technique: string; artUrl: string; retailCents: number };

export function proposeProduct(db: DatabaseSync, env: Env, input: ProductInput, now: number): PodProduct {
  ensurePod(db);
  if (!ID.test(input.id)) throw new Error("POD_PRODUCT_ID");
  if (!getVenture(db, input.ventureId)) throw new Error("POD_VENTURE");
  const title = input.title.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 80);
  if (!title || /\d{8,}/.test(title.replace(/[\s-]/g, ""))) throw new Error("POD_TITLE");
  if (!Number.isSafeInteger(input.variantId) || input.variantId <= 0) throw new Error("POD_VARIANT");
  if (!WORD.test(input.placement) || !WORD.test(input.technique)) throw new Error("POD_PLACEMENT");
  if (!artUrlAllowed(input.artUrl, env)) throw new Error("POD_ART_URL");
  if (!Number.isSafeInteger(input.retailCents) || input.retailCents < 100 || input.retailCents > 100_000) throw new Error("POD_PRICE");
  const added = db
    .prepare("INSERT OR IGNORE INTO pod_products(id, venture_id, title, variant_id, placement, technique, art_url, retail_cents, status, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, 'proposed', ?)")
    .run(input.id, input.ventureId, title, input.variantId, input.placement, input.technique, input.artUrl, input.retailCents, now);
  if (Number(added.changes) !== 1) throw new Error("POD_PRODUCT_EXISTS");
  return getProduct(db, input.id)!;
}

/**
 * The owner's decision, made after looking at the art. Approval needs the owner to state that the
 * picture is Zoora's own and copies nobody's work, character, logo or name.
 */
export function decideProduct(db: DatabaseSync, id: string, decision: "approved" | "declined" | "retired", ownArt: boolean, now: number): PodProduct {
  ensurePod(db);
  const current = getProduct(db, id);
  if (!current) throw new Error("POD_PRODUCT_UNKNOWN");
  if (decision === "retired") {
    if (current.status !== "approved") throw new Error("POD_PRODUCT_STATE");
  } else if (current.status !== "proposed") throw new Error("POD_PRODUCT_STATE");
  if (decision === "approved" && ownArt !== true) throw new Error("POD_OWN_ART_REQUIRED");
  if (!["approved", "declined", "retired"].includes(decision)) throw new Error("POD_DECISION");
  db.prepare("UPDATE pod_products SET status = ?, decided_at = ? WHERE id = ?").run(decision, now, id);
  return getProduct(db, id)!;
}

const STUCK: OrderStatus[] = ["refused", "failed", "canceled"];

function set(db: DatabaseSync, id: string, status: OrderStatus, now: number, fields: { reason?: string; costCents?: number | null; printfulId?: number } = {}): void {
  if (STUCK.includes(status)) {
    const row = db.prepare("SELECT paid_ref, status FROM pod_orders WHERE id = ?").get(id) as { paid_ref: string | null; status: string } | undefined;
    // A customer paid and will not get the print. The owner must hear about it.
    if (row?.paid_ref && row.status !== status) deskNotifier(db).notify({ kind: "delivery", title: "A paid print order needs a refund", detail: `${id} is ${status}${fields.reason ? ` (${fields.reason})` : ""}. Send the money back from the venture desk.` });
  }
  db.prepare("UPDATE pod_orders SET status = ?, reason = ?, cost_cents = COALESCE(?, cost_cents), printful_id = COALESCE(?, printful_id), updated_at = ? WHERE id = ?").run(status, fields.reason ?? "", fields.costCents ?? null, fields.printfulId ?? null, now, id);
}

function code(error: unknown): string {
  return error instanceof PrintfulError ? error.message : "POD_FAILED";
}

/** These mean the call may have reached Printful. The order is read back before anything else is done. */
function unsure(error: unknown): boolean {
  return error instanceof PrintfulError && ["PRINTFUL_UNREACHABLE", "PRINTFUL_DOWN", "PRINTFUL_BAD_REPLY"].includes(error.message);
}

export type OpenInput = { id: string; productId: string; quantity: number; paidRef: string | null; recipient: Recipient };

/**
 * Opens a draft at Printful. `paidRef` is the payment that covers the order; null means a sample, which
 * the venture's budget pays for. One payment opens one order. Calling again with the same id returns
 * the order as it stands and sends nothing.
 */
export async function openPodOrder(db: DatabaseSync, env: Env, input: OpenInput, now: number, fetchImpl: typeof fetch = fetch): Promise<PodOrder> {
  ensurePod(db);
  if (!ID.test(input.id)) throw new Error("POD_ORDER_ID");
  const existing = getPodOrder(db, input.id);
  if (existing) return existing;
  const item = getProduct(db, input.productId);
  if (!item || item.status !== "approved") throw new Error("POD_PRODUCT_NOT_APPROVED");
  const venture = getVenture(db, item.ventureId);
  if (!venture || venture.status !== "active" || venture.deadlineMs == null || venture.deadlineMs <= now) throw new Error("POD_VENTURE_NOT_RUNNING");
  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 20) throw new Error("POD_QUANTITY");
  if (input.paidRef != null && !PAID_REF.test(input.paidRef)) throw new Error("POD_PAID_REF");
  if (input.paidRef != null && db.prepare("SELECT 1 FROM pod_orders WHERE paid_ref = ?").get(input.paidRef)) throw new Error("POD_PAID_REF_USED");
  // The row is written before the network call, so a crash in between leaves a record to check.
  db.prepare("INSERT INTO pod_orders(id, product_id, venture_id, quantity, retail_cents, paid_ref, status, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, 'opening', ?, ?)").run(input.id, item.id, item.ventureId, input.quantity, item.retailCents, input.paidRef, now, now);
  await sendDraft(db, env, input.id, item, input.quantity, input.recipient, now, fetchImpl);
  return getPodOrder(db, input.id)!;
}

/** The order row must already say "opening". */
async function sendDraft(db: DatabaseSync, env: Env, id: string, item: PodProduct, quantity: number, recipient: Recipient, now: number, fetchImpl: typeof fetch): Promise<void> {
  try {
    const made = await createDraft(env, { externalId: id, recipient, items: [{ variantId: item.variantId, quantity, retailCents: item.retailCents, name: item.title, placement: item.placement, technique: item.technique, artUrl: item.artUrl }] }, fetchImpl);
    set(db, id, "draft", now, { printfulId: made.id });
  } catch (error) {
    set(db, id, unsure(error) ? "check" : "failed", now, { reason: unsure(error) ? "OPEN" : code(error) });
  }
}

export function minMarginPercent(env: Env): number {
  const raw = env.POD_MIN_MARGIN_PERCENT ?? "";
  if (!/^\d{1,2}$/.test(raw)) return DEFAULT_MIN_MARGIN_PERCENT;
  return Number(raw);
}

/**
 * Printful has the order. The status is written first, so a problem in the books can never leave an
 * order looking unprinted. The order id is in each line's key, not its memo, because a memo refuses long
 * runs of digits and an id may contain one.
 */
function finalize(db: DatabaseSync, env: Env, current: PodOrder, now: number): void {
  set(db, current.id, "confirmed", now);
  const cost = current.costCents ?? 0;
  try {
    if (current.paidRef != null) ventureLine(db, current.ventureId, { kind: "income", cents: current.retailCents * current.quantity, category: "prints", memo: "a print, paid", idem: `pod:sale:${current.id}` }, now);
    // Printful charges the billing method on its account. Unless that is a balance kept in the treasury, it is the owner's card.
    if (cost > 0) ventureLine(db, current.ventureId, { kind: "expense", cents: cost, category: current.paidRef != null ? "print-cost" : "sample", memo: current.paidRef != null ? "printing and postage" : "a sample", paidFrom: env.PRINTFUL_PAID_FROM === "treasury" ? "treasury" : "outside", idem: `pod:cost:${current.id}` }, now);
  } catch {
    deskNotifier(db).notify({ kind: "ledger", title: "A print order is missing from the books", detail: `${current.id} was printed, and its lines could not be written. Add them by hand at the economy desk.` });
  }
}

async function drop(db: DatabaseSync, env: Env, current: PodOrder, reason: string, now: number, fetchImpl: typeof fetch): Promise<void> {
  if (current.printfulId != null) await deleteDraft(env, current.printfulId, fetchImpl).catch(() => undefined);
  set(db, current.id, "refused", now, { reason });
}

async function price(db: DatabaseSync, env: Env, current: PodOrder, seen: RemoteOrder, now: number, fetchImpl: typeof fetch): Promise<void> {
  if (seen.costsFailed) return drop(db, env, current, "COSTS_FAILED", now, fetchImpl);
  if (!seen.costsReady || seen.costCents == null) return;
  if (current.paidRef != null) {
    const retail = current.retailCents * current.quantity;
    if ((retail - seen.costCents) * 100 < retail * minMarginPercent(env)) return drop(db, env, { ...current, costCents: seen.costCents }, "MARGIN", now, fetchImpl);
  }
  set(db, current.id, "priced", now, { costCents: seen.costCents });
}

/**
 * Reads the order back from Printful and moves it one step. Safe to call any number of times. It never
 * confirms: it only records what Printful says has already happened.
 */
export async function syncPodOrder(db: DatabaseSync, env: Env, id: string, now: number, fetchImpl: typeof fetch = fetch): Promise<PodOrder> {
  const current = getPodOrder(db, id);
  if (!current) throw new Error("POD_ORDER_UNKNOWN");
  if (!["draft", "check", "opening", "confirming"].includes(current.status)) return current;
  // "opening" and "confirming" are held while a call is in flight. Only one left behind by a crash is read back.
  if ((current.status === "opening" || current.status === "confirming") && now - current.updatedAt < IN_FLIGHT_MS) return current;
  try {
    if (current.printfulId == null) {
      // The create call may never have arrived. Look the order up by our own id.
      const seen = await getOrder(env, current.id, fetchImpl).catch((error) => {
        if (error instanceof PrintfulError && error.message === "PRINTFUL_NOT_FOUND") return null;
        throw error;
      });
      if (!seen) set(db, id, "failed", now, { reason: "NEVER_ARRIVED" });
      else {
        set(db, id, "draft", now, { printfulId: seen.id });
        await price(db, env, { ...current, printfulId: seen.id }, seen, now, fetchImpl);
      }
    } else {
      const seen = await getOrder(env, current.printfulId, fetchImpl);
      if (PRINTING.includes(seen.status)) {
        // Printful has it past draft, so a confirm did arrive: ours, or one made by hand in Printful.
        finalize(db, env, { ...current, costCents: current.costCents ?? seen.costCents }, now);
      } else if (seen.status !== "draft") {
        set(db, id, "failed", now, { reason: `REMOTE_${seen.status.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 20)}` });
      } else if (current.status === "draft") await price(db, env, current, seen, now, fetchImpl);
      else set(db, id, current.costCents != null ? "priced" : "draft", now);
    }
  } catch (error) {
    // Left as it was. The next sync tries again.
    db.prepare("UPDATE pod_orders SET reason = ?, updated_at = ? WHERE id = ?").run(code(error), now, id);
  }
  return getPodOrder(db, id)!;
}

export function autoConfirmOn(db: DatabaseSync): boolean {
  return flag(db, "pod_auto_confirm") === "1";
}

export type ConfirmResult = { ok: true; order: PodOrder } | { ok: false; reason: string; order: PodOrder | null };

/**
 * The step that prints and charges. `by` is who is asking. "owner" is a click at the desk. "auto" is
 * Zoora's own code, and passes only when the owner switched it on, a customer has paid, and the venture
 * is running with nothing from outside behind it.
 */
export async function confirmPodOrder(db: DatabaseSync, env: Env, id: string, by: "owner" | "auto", now: number, fetchImpl: typeof fetch = fetch): Promise<ConfirmResult> {
  const current = getPodOrder(db, id);
  if (!current) return { ok: false, reason: "POD_ORDER_UNKNOWN", order: null };
  if (current.status !== "priced" || current.printfulId == null || current.costCents == null) return { ok: false, reason: "POD_NOT_PRICED", order: current };
  if (by === "auto") {
    if (!autoConfirmOn(db)) return { ok: false, reason: "POD_OWNER_CONFIRMS", order: current };
    if (current.paidRef == null) return { ok: false, reason: "POD_SAMPLE_IS_OWNERS", order: current };
  } else if (by !== "owner") return { ok: false, reason: "POD_BY", order: current };
  const item = getProduct(db, current.productId);
  if (!item || item.status !== "approved") return { ok: false, reason: "POD_PRODUCT_NOT_APPROVED", order: current };
  const income = current.paidRef != null ? current.retailCents * current.quantity : 0;
  const allowed = ventureSpendAllowed(db, current.ventureId, Math.max(0, current.costCents - income), now);
  // The owner may confirm an order in a venture that carries an outside mark. Zoora's own code may not.
  if (!allowed.ok && !(by === "owner" && allowed.reason === "TAINTED")) return { ok: false, reason: `POD_VENTURE_${allowed.reason}`, order: current };
  const claimed = db.prepare("UPDATE pod_orders SET status = 'confirming', updated_at = ? WHERE id = ? AND status = 'priced'").run(now, id);
  if (Number(claimed.changes) !== 1) return { ok: false, reason: "POD_NOT_PRICED", order: getPodOrder(db, id) };
  try {
    await confirmOrder(env, current.printfulId, fetchImpl);
  } catch (error) {
    if (unsure(error)) set(db, id, "check", now, { reason: "CONFIRM" });
    else set(db, id, "priced", now, { reason: code(error) });
    return { ok: false, reason: code(error), order: getPodOrder(db, id) };
  }
  finalize(db, env, current, now);
  return { ok: true, order: getPodOrder(db, id)! };
}

/**
 * The beat, every few minutes. It opens drafts for orders paid on the site, reads back every order that
 * is waiting on Printful, and notes which printed orders have shipped or were cancelled. It confirms a
 * priced, paid order only when the owner has switched that on. Otherwise it confirms nothing.
 */
export async function syncOpenPodOrders(db: DatabaseSync, env: Env, now: number, fetchImpl: typeof fetch = fetch): Promise<number> {
  ensurePod(db);
  const paid = (db.prepare("SELECT id FROM pod_orders WHERE status = 'paid' ORDER BY created_at LIMIT 40").all() as { id: string }[]).map((row) => row.id);
  for (const id of paid) await openPaidPrint(db, env, id, now, fetchImpl);
  const waiting = (db.prepare("SELECT id FROM pod_orders WHERE status IN ('draft', 'check', 'opening', 'confirming') ORDER BY created_at LIMIT 40").all() as { id: string }[]).map((row) => row.id);
  for (const id of waiting) await syncPodOrder(db, env, id, now, fetchImpl);
  if (autoConfirmOn(db)) {
    const ready = (db.prepare("SELECT id FROM pod_orders WHERE status = 'priced' AND paid_ref IS NOT NULL ORDER BY created_at LIMIT 40").all() as { id: string }[]).map((row) => row.id);
    for (const id of ready) await confirmPodOrder(db, env, id, "auto", now, fetchImpl);
  }
  const printing = (db.prepare("SELECT id FROM pod_orders WHERE status = 'confirmed' AND created_at >= ? ORDER BY updated_at LIMIT 40").all(now - 90 * 86_400_000) as { id: string }[]).map((row) => row.id);
  for (const id of printing) await readShipping(db, env, id, now, fetchImpl);
  return paid.length + waiting.length + printing.length;
}

/** Reads a printed order back. Printful's word is recorded: shipped, or cancelled. Nothing is sent. */
export async function readShipping(db: DatabaseSync, env: Env, id: string, now: number, fetchImpl: typeof fetch = fetch): Promise<PodOrder> {
  const current = getPodOrder(db, id);
  if (!current) throw new Error("POD_ORDER_UNKNOWN");
  if (current.status !== "confirmed" || current.printfulId == null) return current;
  try {
    const seen = await getOrder(env, current.printfulId, fetchImpl);
    if (seen.status === "fulfilled") set(db, id, "shipped", now);
    // Printful stopped it after it was charged. Any money Printful returns is entered by the owner.
    else if (seen.status === "canceled" || seen.status === "failed") set(db, id, "canceled", now, { reason: `PRINTFUL_${seen.status.toUpperCase()}` });
    else db.prepare("UPDATE pod_orders SET updated_at = ? WHERE id = ?").run(now, id);
  } catch {
    db.prepare("UPDATE pod_orders SET updated_at = ? WHERE id = ?").run(now, id);
  }
  return getPodOrder(db, id)!;
}

export function shipCountries(env: Env): string[] {
  const list = (env.POD_SHIP_COUNTRIES ?? "US").split(",").map((item) => item.trim().toUpperCase()).filter((item) => /^[A-Z]{2}$/.test(item));
  return list.length ? list.slice(0, 20) : ["US"];
}

export function shippingCents(env: Env): number {
  const raw = (env.POD_SHIPPING_CENTS ?? "").trim();
  if (!/^\d{1,5}$/.test(raw)) return 0;
  return Number(raw);
}

/** Whether a visitor can buy a print now: sales open, Stripe and Printful both set, and somewhere to send art from. */
export function printCheckoutOpen(env: Env, salesOpen: boolean): boolean {
  const secret = env.STRIPE_SECRET_KEY ?? "";
  return salesOpen && printfulConfigured(env) && (secret.startsWith("sk_live_") || secret.startsWith("sk_test_"));
}

/** What the public page shows: approved products in a running venture. */
export function printsForSale(db: DatabaseSync, now: number): PodProduct[] {
  return listProducts(db).filter((item) => {
    if (item.status !== "approved") return false;
    const venture = getVenture(db, item.ventureId);
    return Boolean(venture && venture.status === "active" && venture.deadlineMs != null && venture.deadlineMs > now);
  });
}

/** Starts a card checkout that asks for a shipping address. No order exists until Stripe says it was paid. */
export async function printCheckout(db: DatabaseSync, env: Env, productId: string, salesOpen: boolean, now: number, client?: SalesClient): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  ensurePod(db);
  if (!printCheckoutOpen(env, salesOpen)) return { ok: false, error: "CLOSED" };
  const item = printsForSale(db, now).find((entry) => entry.id === productId);
  if (!item) return { ok: false, error: "NOT_LISTED" };
  try {
    const session = await (client ?? stripeSalesClient(env.STRIPE_SECRET_KEY ?? "")).createCheckout({
      creationId: item.id,
      title: item.title,
      priceCents: item.retailCents,
      origin: env.LUMEN_ORIGIN || "https://zoora.ai",
      idempotencyKey: `print:${item.id}:${randomBytes(8).toString("hex")}`,
      print: { productId: item.id, countries: shipCountries(env), shippingCents: shippingCents(env), returnPath: "/merch" },
    });
    return { ok: true, url: session.url };
  } catch {
    return { ok: false, error: "SALES_PROVIDER_ERROR" };
  }
}

/**
 * Called from the Stripe webhook when a print checkout is paid. It writes the order and the sale, and
 * sends nothing. The same session twice is one order.
 */
export function recordPaidPrint(db: DatabaseSync, input: { sessionId: string; productId: string; amountCents: number; paymentIntentId: string | null; chargeId?: string | null }, now: number): PodOrder | null {
  ensurePod(db);
  if (!/^cs_[A-Za-z0-9_]{8,120}$/.test(input.sessionId) || !Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) return null;
  const paidRef = `stripe:${input.sessionId}`;
  const seen = db.prepare("SELECT id FROM pod_orders WHERE paid_ref = ?").get(paidRef) as { id: string } | undefined;
  if (seen) return getPodOrder(db, seen.id);
  const item = getProduct(db, input.productId);
  const id = `ord-${randomBytes(6).toString("hex")}`;
  db.prepare("INSERT INTO pod_orders(id, product_id, venture_id, quantity, retail_cents, paid_ref, status, created_at, updated_at, payment_intent_id) VALUES(?, ?, ?, 1, ?, ?, 'paid', ?, ?, ?)").run(id, item?.id ?? input.productId.slice(0, 32), item?.ventureId ?? "", input.amountCents, paidRef, now, now, input.paymentIntentId);
  new Ledger(db).append({
    id: `print-sale-${id}`,
    atMs: now,
    kind: "sale",
    amountCents: input.amountCents,
    status: "confirmed",
    provider: "stripe",
    providerTransactionId: input.chargeId || input.paymentIntentId || input.sessionId,
    chargeId: input.chargeId ?? null,
    paymentIntentId: input.paymentIntentId,
    idempotencyKey: `print:${input.paymentIntentId || input.sessionId}`,
    ref: id,
    note: `A print was paid for${item ? `: ${item.title}` : ""}. It is not printed yet.`,
  });
  // Paid for something that is no longer on sale. It cannot be printed, so it goes straight to the refund list.
  if (!item || item.status !== "approved") set(db, id, "refused", now, { reason: "NOT_FOR_SALE" });
  return getPodOrder(db, id);
}

/**
 * Opens the draft for an order paid on the site. Stripe is asked again whether it was paid, for what,
 * and where it ships. If Stripe cannot be reached the order waits and the next beat tries again.
 */
export async function openPaidPrint(db: DatabaseSync, env: Env, id: string, now: number, fetchImpl: typeof fetch = fetch): Promise<PodOrder> {
  const current = getPodOrder(db, id);
  if (!current) throw new Error("POD_ORDER_UNKNOWN");
  if (current.status !== "paid" || !current.paidRef?.startsWith("stripe:")) return current;
  const item = getProduct(db, current.productId);
  if (!item || item.status !== "approved") {
    set(db, id, "refused", now, { reason: "NOT_FOR_SALE" });
    return getPodOrder(db, id)!;
  }
  let session: PaidSession;
  try {
    session = await readCheckoutSession(env.STRIPE_SECRET_KEY ?? "", current.paidRef.slice("stripe:".length), fetchImpl);
  } catch {
    db.prepare("UPDATE pod_orders SET reason = 'STRIPE_UNREACHABLE', updated_at = ? WHERE id = ?").run(now, id);
    return getPodOrder(db, id)!;
  }
  if (!session.paid || session.printProduct !== item.id || session.amountCents !== current.retailCents) {
    set(db, id, "refused", now, { reason: "PAYMENT_MISMATCH" });
    return getPodOrder(db, id)!;
  }
  const to = session.shipping;
  if (!to || !to.line1 || !to.city || !/^[A-Z]{2}$/.test(to.country) || !to.postalCode || !shipCountries(env).includes(to.country)) {
    set(db, id, "refused", now, { reason: "NO_ADDRESS" });
    return getPodOrder(db, id)!;
  }
  const claimed = db.prepare("UPDATE pod_orders SET status = 'opening', updated_at = ? WHERE id = ? AND status = 'paid'").run(now, id);
  if (Number(claimed.changes) !== 1) return getPodOrder(db, id)!;
  await sendDraft(db, env, id, item, 1, { name: to.name || "Customer", address1: to.line1, address2: to.line2 || undefined, city: to.city, stateCode: to.state || undefined, countryCode: to.country, zip: to.postalCode }, now, fetchImpl);
  return getPodOrder(db, id)!;
}

/**
 * Called from the Stripe webhook when a payment is refunded or disputed. An order that has not printed
 * is stopped. One that has printed gets a refund line on its venture's scorecard.
 */
export function printRefunded(db: DatabaseSync, env: Env, paymentIntentId: string | null, refunds: { id: string; amountCents: number }[], now: number, fetchImpl: typeof fetch = fetch): void {
  ensurePod(db);
  if (!paymentIntentId) return;
  const row = db.prepare("SELECT id FROM pod_orders WHERE payment_intent_id = ?").get(paymentIntentId) as { id: string } | undefined;
  const current = row ? getPodOrder(db, row.id) : null;
  if (!current) return;
  if (current.status === "confirmed" || current.status === "shipped") {
    for (const refund of refunds) {
      if (!/^[A-Za-z0-9_]{4,80}$/.test(refund.id) || refund.amountCents <= 0) continue;
      ventureLine(db, current.ventureId, { kind: "expense", cents: refund.amountCents, category: "refund", memo: "a print, refunded", idem: `pod:refund:${refund.id}` }, now);
    }
    return;
  }
  if (current.status === "refunded") return;
  // "confirming" is left alone: the print call is in flight, and the next read settles it.
  if (current.status === "confirming") return;
  db.prepare("UPDATE pod_orders SET status = 'refunded', reason = '', updated_at = ? WHERE id = ?").run(now, current.id);
  if (current.printfulId != null && printfulConfigured(env)) void deleteDraft(env, current.printfulId, fetchImpl).catch(() => undefined);
}

/** The owner sends a customer's money back for a paid order that will not be printed. */
export async function refundPaidPrint(db: DatabaseSync, env: Env, id: string, now: number, client?: SalesClient): Promise<PodOrder> {
  const current = getPodOrder(db, id);
  if (!current) throw new Error("POD_ORDER_UNKNOWN");
  if (!STUCK.includes(current.status) || !current.paidRef?.startsWith("stripe:") || !current.paymentIntentId) throw new Error("POD_NOT_REFUNDABLE");
  try {
    await (client ?? stripeSalesClient(env.STRIPE_SECRET_KEY ?? "")).createRefund({ paymentIntentId: current.paymentIntentId, idempotencyKey: `print-refund:${current.id}` });
  } catch {
    throw new Error("POD_REFUND_FAILED");
  }
  // The refund itself is booked in the ledger when Stripe reports it.
  db.prepare("UPDATE pod_orders SET status = 'refunded', updated_at = ? WHERE id = ?").run(now, id);
  return getPodOrder(db, id)!;
}
