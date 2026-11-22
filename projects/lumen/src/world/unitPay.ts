import type { DatabaseSync } from "node:sqlite";
import { quoteSolOrder } from "../money/solana";
import type { Env } from "../money/rules";
import { askOf, getUnit } from "./units";

/**
 * Buying a home or a shop.
 *
 * The price is hers, in dollars. It is paid in SOL to the owner's public wallet, through the same
 * quote and the same check on the chain that the shop already uses (`src/money/solana.ts`). Nothing
 * here holds a key or moves money. A unit becomes sold only when a finalized payment of at least the
 * quoted amount, to that wallet, carrying this order's reference, has been read from the chain.
 *
 * While a quote is live nobody else can be quoted for the same unit, so two buyers are not both asked
 * to pay for it. A quote lasts ten minutes at most.
 */
export type UnitQuote =
  | { ok: true; order: string; unit: string; address: string; priceCents: number; payTo: string; lamports: string; reference: string; url: string; expiresAt: number }
  | { ok: false; reason: string };

export async function quoteUnit(db: DatabaseSync, env: Env, unitId: string, now: number, fetchImpl: typeof fetch = fetch): Promise<UnitQuote> {
  const unit = getUnit(db, unitId);
  if (!unit) return { ok: false, reason: "UNKNOWN" };
  if (unit.status !== "open") return { ok: false, reason: "TAKEN" };
  if (db.prepare("SELECT 1 FROM sol_orders WHERE item_kind = 'unit' AND item_id = ? AND status = 'quoted' AND expires_at > ? LIMIT 1").get(unit.id, now)) return { ok: false, reason: "HELD" };
  const priceCents = askOf(db, unit).priceCents;
  const quote = await quoteSolOrder(db, env, { kind: "unit", itemId: unit.id, title: unit.address, usdCents: priceCents }, now, fetchImpl);
  if (!quote.ok) return quote;
  const row = db.prepare("SELECT recipient, reference_key FROM sol_orders WHERE id = ?").get(quote.id) as { recipient: string; reference_key: string };
  return { ok: true, order: quote.id, unit: unit.id, address: unit.address, priceCents, payTo: row.recipient, lamports: quote.lamports, reference: row.reference_key, url: quote.url, expiresAt: quote.expiresAt };
}

/** Whether an order is a quote for this unit. A payment is only ever checked against the unit it was quoted for. */
export function orderIsFor(db: DatabaseSync, orderId: string, unitId: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sol_orders WHERE id = ? AND item_kind = 'unit' AND item_id = ?").get(orderId, unitId));
}
