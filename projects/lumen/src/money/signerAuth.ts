import { createHmac, timingSafeEqual } from "node:crypto";

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
