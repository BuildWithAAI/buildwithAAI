import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SIGNER_FRESH_MS = 60_000;

/**
 * A nonce and a send time, signed with the rest of the body. Without them two identical
 * instructions carry the same signature, and a captured request can be sent again.
 * The signer must refuse a nonce it has seen and a time outside SIGNER_FRESH_MS.
 */
export function signerFreshness(now = Date.now()): { nonce: string; issuedAtMs: number } {
  return { nonce: randomBytes(16).toString("hex"), issuedAtMs: now };
}

/** The signer's side of the freshness check. `seen` is the signer's own store of used nonces. */
export function signerFresh(body: string, now: number, seen: (nonce: string) => boolean): boolean {
  let parsed: { nonce?: unknown; issuedAtMs?: unknown };
  try {
    parsed = JSON.parse(body) as typeof parsed;
  } catch {
    return false;
  }
  if (typeof parsed.nonce !== "string" || !/^[0-9a-f]{32}$/.test(parsed.nonce)) return false;
  if (typeof parsed.issuedAtMs !== "number" || !Number.isSafeInteger(parsed.issuedAtMs)) return false;
  if (Math.abs(now - parsed.issuedAtMs) > SIGNER_FRESH_MS) return false;
  return !seen(parsed.nonce);
}

/** HMAC-SHA256 of the raw body. The signer must check `x-lumen-signature` before it signs. */
export function signerHeaders(secret: string | undefined, body: string): Record<string, string> | null {
  if (!secret) return null;
  const signature = createHmac("sha256", secret).update(body).digest("hex");
  return { "content-type": "application/json", "x-lumen-signature": signature };
}

export function signerSignatureOk(secret: string, body: string, header: string | null): boolean {
  const expected = signerHeaders(secret, body)?.["x-lumen-signature"];
  if (!expected || !header || expected.length !== header.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(header));
}
