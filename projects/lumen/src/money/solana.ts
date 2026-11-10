import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { flag } from "../db/db";
import { Ledger } from "./ledger";
import { vetResearchUrl } from "../research/ssrf";
import { killSwitchOn, publicMoneyClosed, type Env } from "./rules";

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const LAMPORTS = 1_000_000_000n;
const DEFAULT_QUOTE_MS = 10 * 60 * 1000;

export type SolTx = {
  blockTime?: number | null;
  meta?: { err?: unknown; preBalances?: number[]; postBalances?: number[] } | null;
  transaction?: { message?: { accountKeys?: (string | { pubkey?: string })[] }; signatures?: string[] };
};

/** Unix seconds from getTransaction, as milliseconds. Missing time stays undefined. */
export function chainTimeMs(tx: SolTx | null): number | undefined {
  if (typeof tx?.blockTime !== "number" || !Number.isFinite(tx.blockTime)) return undefined;
  return Math.round(tx.blockTime * 1000);
}

/** Quote, verify, and the download link all stop for these. */
export function solanaPayBlock(db: DatabaseSync, env: Env): "KILL_SWITCH" | "SHOP_KILL" | "PUBLIC_MODE" | null {
  if (killSwitchOn(env, flag(db, "kill") === "1")) return "KILL_SWITCH";
  if (flag(db, "shop_kill") === "1") return "SHOP_KILL";
  if (publicMoneyClosed(env)) return "PUBLIC_MODE";
  return null;
}

export function encodeBase58(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros += 1;
  const digits = [0];
  for (let i = zeros; i < bytes.length; i += 1) {
    let carry = bytes[i] ?? 0;
    for (let j = 0; j < digits.length; j += 1) {
      carry += (digits[j] ?? 0) << 8;
      digits[j] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let out = "1".repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i -= 1) out += ALPHABET[digits[i] ?? 0];
  return out;
}

export function decodeBase58(text: string): Uint8Array | null {
  if (!text || text.length > 44 || [...text].some((char) => !ALPHABET.includes(char))) return null;
  const bytes = [0];
  for (const char of text) {
    let carry = ALPHABET.indexOf(char);
    if (carry < 0) return null;
    for (let j = 0; j < bytes.length; j += 1) {
      carry += (bytes[j] ?? 0) * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  let zeros = 0;
  for (const char of text) {
    if (char !== "1") break;
    zeros += 1;
  }
  const out = new Uint8Array(zeros + bytes.length);
  for (let i = 0; i < bytes.length; i += 1) out[out.length - 1 - i] = bytes[i] ?? 0;
  return out.length === 32 ? out : null;
}

export function publicKeyOk(value: string): boolean {
  return decodeBase58(value.trim()) != null;
}

export function randomReference(): string {
  return encodeBase58(randomBytes(32));
}

/** Convert a USD cent price at a live SOL/USD rate. Rounds up so the quote is not short. */
export function lamportsForUsd(usdCents: number, solUsd: number): { lamports: bigint; micro: number } | null {
  if (!Number.isInteger(usdCents) || usdCents <= 0 || !Number.isFinite(solUsd) || solUsd <= 0) return null;
  const micro = Math.round(solUsd * 1_000_000);
  if (!Number.isSafeInteger(micro) || micro <= 0) return null;
  const lamports = (BigInt(usdCents) * 10_000_000_000_000n + BigInt(micro) - 1n) / BigInt(micro);
  if (lamports <= 0n) return null;
  return { lamports, micro };
}

export function solAmount(lamports: bigint): string {
  const whole = lamports / LAMPORTS;
  const frac = (lamports % LAMPORTS).toString().padStart(9, "0").replace(/0+$/, "");
  return frac ? `${whole.toString()}.${frac}` : whole.toString();
}

export function solanaPayUrl(input: { recipient: string; lamports: bigint; reference: string; title: string }): string {
  const params = new URLSearchParams({
    amount: solAmount(input.lamports),
    reference: input.reference,
    label: "Zoora",
    message: input.title.slice(0, 80),
  });
  return `solana:${input.recipient}?${params.toString()}`;
}

export async function fetchSolUsd(url: string, fetchImpl: typeof fetch = fetch): Promise<number | null> {
  if (!url.startsWith("https://") || !vetResearchUrl(url).ok) return null;
  let response: Response;
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(6000) });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  const json = (await response.json()) as { usd?: unknown; solana?: { usd?: unknown } };
  const raw = typeof json.usd === "number" ? json.usd : json.solana?.usd;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 1 || raw > 100_000) return null;
  return raw;
}

export function accountKeys(tx: SolTx): string[] {
  return (tx.transaction?.message?.accountKeys ?? []).flatMap((key) => {
    if (typeof key === "string") return [key];
    return key.pubkey ? [key.pubkey] : [];
  });
}

export function verifySolTransaction(tx: SolTx | null, expect: { recipient: string; lamports: bigint; reference: string }): { ok: true; paid: bigint } | { ok: false; reason: string } {
  if (!tx) return { ok: false, reason: "UNFINALIZED" };
  if (tx.meta?.err) return { ok: false, reason: "FAILED" };
  const keys = accountKeys(tx);
  if (!keys.includes(expect.reference)) return { ok: false, reason: "REFERENCE" };
  const index = keys.indexOf(expect.recipient);
  if (index < 0) return { ok: false, reason: "RECIPIENT" };
  const before = tx.meta?.preBalances?.[index];
  const after = tx.meta?.postBalances?.[index];
  if (typeof before !== "number" || typeof after !== "number") return { ok: false, reason: "RECIPIENT" };
  const paid = BigInt(after) - BigInt(before);
  if (paid < expect.lamports) return { ok: false, reason: "UNDERPAID" };
  return { ok: true, paid };
}

export async function quoteSolOrder(db: DatabaseSync, env: Env, input: { kind: "shop" | "nft"; itemId: string; title: string; usdCents: number }, now: number, fetchImpl: typeof fetch = fetch): Promise<{ ok: true; id: string; url: string; lamports: string; expiresAt: number } | { ok: false; reason: string }> {
  const blocked = solanaPayBlock(db, env);
  if (blocked) return { ok: false, reason: blocked };
  const recipient = (env.LUMEN_SOL_RECEIVE_ADDRESS ?? "").trim();
  if (!publicKeyOk(recipient)) return { ok: false, reason: "NO_ADDRESS" };
  const priceUrl = env.LUMEN_SOL_PRICE_URL ?? "";
  if (!priceUrl) return { ok: false, reason: "NO_PRICE" };
  const solUsd = await fetchSolUsd(priceUrl, fetchImpl);
  if (solUsd == null) return { ok: false, reason: "NO_PRICE" };
  const priced = lamportsForUsd(input.usdCents, solUsd);
  if (!priced) return { ok: false, reason: "NO_PRICE" };
  const ttl = Math.min(DEFAULT_QUOTE_MS, Math.max(60_000, Number(env.LUMEN_SOL_QUOTE_MS ?? DEFAULT_QUOTE_MS) || DEFAULT_QUOTE_MS));
  const id = `sol-${randomBytes(4).toString("hex")}`;
  const reference = randomReference();
  db.prepare(
    `INSERT INTO sol_orders(id, item_kind, item_id, title, usd_cents, lamports, sol_usd_micro, recipient, reference_key, signature, status, expires_at, created_at)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'quoted', ?, ?)`,
  ).run(id, input.kind, input.itemId, input.title.slice(0, 80), input.usdCents, priced.lamports.toString(), priced.micro, recipient, reference, now + ttl, now);
  return { ok: true, id, url: solanaPayUrl({ recipient, lamports: priced.lamports, reference, title: input.title }), lamports: priced.lamports.toString(), expiresAt: now + ttl };
}

export function readSolOrder(db: DatabaseSync, id: string): { id: string; title: string; sol: string; url: string; status: string; expiresAt: number } | null {
  const row = db.prepare("SELECT id, title, lamports, recipient, reference_key, status, expires_at FROM sol_orders WHERE id = ?").get(id) as {
    id: string; title: string; lamports: string; recipient: string; reference_key: string; status: string; expires_at: number;
  } | undefined;
  if (!row) return null;
  const lamports = BigInt(row.lamports);
  return {
    id: row.id,
    title: row.title,
    sol: solAmount(lamports),
    url: solanaPayUrl({ recipient: row.recipient, lamports, reference: row.reference_key, title: row.title }),
    status: row.status,
    expiresAt: row.expires_at,
  };
}

export async function fetchFinalized(url: string, signature: string, fetchImpl: typeof fetch = fetch): Promise<SolTx | null> {
  if (!url.startsWith("https://") || !vetResearchUrl(url).ok) return null;
  let response: Response;
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(6000),
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getTransaction",
      params: [signature, { commitment: "finalized", encoding: "json", maxSupportedTransactionVersion: 0 }],
    }),
  });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  const json = (await response.json()) as { result?: SolTx | null };
  return json.result ?? null;
}

function flagSolRefund(db: DatabaseSync, orderId: string, signature: string, reason: string, lamports: bigint, now: number): void {
  db.prepare("INSERT INTO sol_refund_flags(order_id, signature, reason, lamports, created_at) VALUES(?, ?, ?, ?, ?)").run(orderId, signature, reason, lamports.toString(), now);
}

export function verifySolPayment(db: DatabaseSync, orderId: string, signature: string, tx: SolTx | null, now: number, proof?: { txTime?: number }, env: Env = process.env): { ok: true; token: string | null } | { ok: false; reason: string } {
  const blocked = solanaPayBlock(db, env);
  if (blocked) return { ok: false, reason: blocked };
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature)) return { ok: false, reason: "SIGNATURE" };
  const used = db.prepare("SELECT id FROM sol_orders WHERE signature = ?").get(signature) as { id: string } | undefined;
  if (used) return { ok: false, reason: "REUSED" };
  const flagged = db.prepare("SELECT id FROM sol_refund_flags WHERE signature = ?").get(signature) as { id: number } | undefined;
  if (flagged) return { ok: false, reason: "REUSED" };
  const row = db.prepare("SELECT id, item_kind, item_id, title, usd_cents, lamports, recipient, reference_key, status, expires_at, created_at FROM sol_orders WHERE id = ?").get(orderId) as {
    id: string; item_kind: string; item_id: string; title: string; usd_cents: number; lamports: string; recipient: string; reference_key: string; status: string; expires_at: number; created_at: number;
  } | undefined;
  if (!row) return { ok: false, reason: "MISSING" };
  if (row.status === "paid") {
    const checked = verifySolTransaction(tx, { recipient: row.recipient, lamports: 1n, reference: row.reference_key });
    const extra = checked.ok ? checked.paid : 0n;
    flagSolRefund(db, orderId, signature, "SECOND", extra, now);
    return { ok: false, reason: "SECOND" };
  }
  if (row.status !== "quoted") return { ok: false, reason: "MISSING" };
  const sentInside = proof?.txTime != null && proof.txTime >= row.created_at && proof.txTime <= row.expires_at;
  if (row.expires_at < now && !sentInside) return { ok: false, reason: "EXPIRED" };
  const checked = verifySolTransaction(tx, { recipient: row.recipient, lamports: BigInt(row.lamports), reference: row.reference_key });
  if (!checked.ok) return checked;
  const expected = BigInt(row.lamports);
  if (checked.paid > expected) flagSolRefund(db, orderId, signature, "OVERPAY", checked.paid - expected, now);
  db.prepare("UPDATE sol_orders SET status = 'paid', signature = ? WHERE id = ?").run(signature, orderId);
  new Ledger(db).append({
    id: `sol-${orderId}`,
    atMs: now,
    kind: "sale",
    amountCents: row.usd_cents,
    status: "confirmed",
    provider: "solana",
    providerTransactionId: signature,
    idempotencyKey: `sol:${signature}`,
    ref: row.item_id,
    note: `SOL paid for ${row.title}. Signature ${signature}.`,
  });
  let token: string | null = null;
  if (row.item_kind === "shop") {
    token = randomBytes(24).toString("hex");
    db.prepare("INSERT INTO deliveries(token, creation_id, expires_at) VALUES(?, ?, ?)").run(token, row.item_id, now + 72 * 3600_000);
    db.prepare("INSERT INTO shop_orders(id, listing_id, buyer_note, status, charge_id, delivery_token, due_at, created_at) VALUES(?, ?, '', 'delivered', ?, ?, ?, ?)").run(
      `ord-${randomBytes(4).toString("hex")}`, row.item_id, signature, token, now, now,
    );
  }
  return { ok: true, token };
}
