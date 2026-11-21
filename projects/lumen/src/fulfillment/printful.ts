/**
 * Printful, for print on demand. Printful prints and ships; nothing is made until an order is confirmed.
 *
 * This file talks to the v2 orders API and does nothing else. An order is created as a draft, which
 * costs nothing. Printful then works out the cost. Only a separate confirm call sends it to print and
 * charges the billing method on the Printful account. The rules about when a confirm may happen are in
 * `pod.ts`, not here.
 *
 * The token is a Printful private token. Give it the orders scope only, for one store, with an expiry.
 * It is read from the environment, sent in the Authorization header, and never logged or returned.
 * A customer's address is passed through to Printful and is not kept by this code. Error messages carry
 * a short code only, never a response body, because a body can repeat an address.
 */

type Env = Record<string, string | undefined>;
const API = "https://api.printful.com";
const TIMEOUT_MS = 15_000;

export class PrintfulError extends Error {
  constructor(code: string, readonly status: number | null = null) {
    super(code);
  }
}

export type Recipient = { name: string; address1: string; address2?: string; city: string; stateCode?: string; countryCode: string; zip: string; email?: string };
export type PodItem = { variantId: number; quantity: number; retailCents: number; name: string; placement: string; technique: string; artUrl: string };
export type RemoteOrder = { id: number; status: string; costsReady: boolean; costsFailed: boolean; costCents: number | null };

export function printfulConfigured(env: Env): boolean {
  return Boolean((env.PRINTFUL_TOKEN ?? "").trim());
}

/**
 * Art is fetched by Printful from a web address. Only https addresses on the owner's own hosts are
 * sent, so a made-up address cannot point Printful at someone else's picture or at a private machine.
 */
export function artUrlAllowed(raw: string, env: Env): boolean {
  const hosts = (env.PRINTFUL_ART_HOSTS ?? "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (hosts.length === 0 || raw.length > 300) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash) return false;
  if (!/\.(png|jpe?g|pdf)$/i.test(url.pathname)) return false;
  return hosts.includes(url.hostname.toLowerCase());
}

function toCents(value: unknown): number | null {
  if (value == null || value === "") return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000) throw new PrintfulError("PRINTFUL_COSTS");
  return Math.round(amount * 100);
}

async function call(env: Env, method: "GET" | "POST" | "DELETE", path: string, body: unknown, fetchImpl: typeof fetch): Promise<Record<string, unknown>> {
  const token = (env.PRINTFUL_TOKEN ?? "").trim();
  if (!token) throw new PrintfulError("PRINTFUL_NOT_SET");
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  // Needed only by an account-level token. A store-level token already names its store.
  const store = (env.PRINTFUL_STORE_ID ?? "").trim();
  if (store) {
    if (!/^\d{1,12}$/.test(store)) throw new PrintfulError("PRINTFUL_STORE");
    headers["X-PF-Store-Id"] = store;
  }
  let response: Response;
  try {
    response = await fetchImpl(`${API}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "error" });
  } catch {
    // The request may or may not have arrived. The caller must read the order before trying again.
    throw new PrintfulError("PRINTFUL_UNREACHABLE");
  }
  if (response.status === 401 || response.status === 403) throw new PrintfulError("PRINTFUL_AUTH", response.status);
  if (response.status === 404) throw new PrintfulError("PRINTFUL_NOT_FOUND", 404);
  if (response.status === 429) throw new PrintfulError("PRINTFUL_RATE", 429);
  if (!response.ok) throw new PrintfulError(response.status >= 500 ? "PRINTFUL_DOWN" : "PRINTFUL_REFUSED", response.status);
  if (response.status === 204) return {};
  try {
    const parsed = (await response.json()) as { data?: unknown };
    return parsed && typeof parsed.data === "object" && parsed.data !== null ? (parsed.data as Record<string, unknown>) : {};
  } catch {
    throw new PrintfulError("PRINTFUL_BAD_REPLY", response.status);
  }
}

function remote(data: Record<string, unknown>): RemoteOrder {
  const id = Number(data.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw new PrintfulError("PRINTFUL_BAD_REPLY");
  const costs = (data.costs ?? {}) as Record<string, unknown>;
  const state = String(costs.calculation_status ?? "");
  const ready = state === "done";
  const cost = ready ? toCents(costs.total) : null;
  return { id, status: String(data.status ?? ""), costsReady: ready && cost != null, costsFailed: state === "failed", costCents: cost };
}

function money(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** A draft. Nothing is printed and nothing is charged. `externalId` is ours, so the same order is found again. */
export async function createDraft(env: Env, order: { externalId: string; recipient: Recipient; items: PodItem[] }, fetchImpl: typeof fetch = fetch): Promise<RemoteOrder> {
  if (!/^[A-Za-z0-9_-]{4,32}$/.test(order.externalId)) throw new PrintfulError("PRINTFUL_ORDER_ID");
  if (order.items.length < 1 || order.items.length > 20) throw new PrintfulError("PRINTFUL_ITEMS");
  for (const item of order.items) {
    if (!Number.isSafeInteger(item.variantId) || item.variantId <= 0 || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 20) throw new PrintfulError("PRINTFUL_ITEMS");
    if (!artUrlAllowed(item.artUrl, env)) throw new PrintfulError("PRINTFUL_ART_URL");
  }
  const r = order.recipient;
  if (!r.name.trim() || !r.address1.trim() || !r.city.trim() || !/^[A-Z]{2}$/.test(r.countryCode) || !r.zip.trim()) throw new PrintfulError("PRINTFUL_RECIPIENT");
  const data = await call(
    env,
    "POST",
    "/v2/orders",
    {
      external_id: order.externalId,
      shipping: "STANDARD",
      recipient: { name: r.name, address1: r.address1, ...(r.address2 ? { address2: r.address2 } : {}), city: r.city, ...(r.stateCode ? { state_code: r.stateCode } : {}), country_code: r.countryCode, zip: r.zip, ...(r.email ? { email: r.email } : {}) },
      order_items: order.items.map((item) => ({
        source: "catalog",
        catalog_variant_id: item.variantId,
        quantity: item.quantity,
        retail_price: money(item.retailCents),
        name: item.name.slice(0, 80),
        placements: [{ placement: item.placement, technique: item.technique, layers: [{ type: "file", url: item.artUrl }] }],
      })),
    },
    fetchImpl,
  );
  return remote(data);
}

export async function getOrder(env: Env, id: number | string, fetchImpl: typeof fetch = fetch): Promise<RemoteOrder> {
  const ref = typeof id === "number" ? String(id) : `@${id}`;
  if (!/^@?[A-Za-z0-9_-]{1,32}$/.test(ref)) throw new PrintfulError("PRINTFUL_ORDER_ID");
  return remote(await call(env, "GET", `/v2/orders/${ref}`, undefined, fetchImpl));
}

/** Sends the order to print and charges the Printful billing method. It cannot be taken back from here. */
export async function confirmOrder(env: Env, id: number, fetchImpl: typeof fetch = fetch): Promise<void> {
  if (!Number.isSafeInteger(id) || id <= 0) throw new PrintfulError("PRINTFUL_ORDER_ID");
  await call(env, "POST", `/v2/orders/${id}/confirmation`, undefined, fetchImpl);
}

/** Only a draft or failed order that was never charged can be deleted. */
export async function deleteDraft(env: Env, id: number, fetchImpl: typeof fetch = fetch): Promise<void> {
  if (!Number.isSafeInteger(id) || id <= 0) throw new PrintfulError("PRINTFUL_ORDER_ID");
  await call(env, "DELETE", `/v2/orders/${id}`, undefined, fetchImpl);
}
