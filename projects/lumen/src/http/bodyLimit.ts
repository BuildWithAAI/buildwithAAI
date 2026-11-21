import { logSecurity } from "./log";

export const WEBHOOK_MAX_BYTES = 256 * 1024;
export const WORLD_MAX_BYTES = 8 * 1024;

/** Read a request body up to maxBytes. A larger Content-Length or stream is refused before the rest is kept. */
export async function readLimitedText(request: Request, maxBytes: number): Promise<{ ok: true; text: string } | { ok: false; status: 413 }> {
  const declared = request.headers.get("content-length");
  if (declared !== null && declared !== "" && Number(declared) > maxBytes) {
    logSecurity({ event: "body_too_large", status: 413, route: "body" });
    return { ok: false, status: 413 };
  }
  const body = request.body;
  if (!body) return { ok: true, text: "" };
  const reader = body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const step = await reader.read();
    if (step.done) break;
    total += step.value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      logSecurity({ event: "body_too_large", status: 413, route: "body" });
      return { ok: false, status: 413 };
    }
    parts.push(step.value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    merged.set(part, offset);
    offset += part.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(merged) };
}
