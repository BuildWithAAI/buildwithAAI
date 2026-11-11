import { clientAddress } from "../../../auth/owner";
import { publicModeOn } from "../../../auth/publicMode";
import { readLimitedText, WORLD_MAX_BYTES } from "../../../http/bodyLimit";
import { getEngine } from "../../../server/engine";
import { visitorsEnabled } from "../../../world/visitors";
import type { DatabaseSync } from "node:sqlite";

const QUIET = { "cache-control": "no-store" };

export function visitorsClosed(): Response {
  return Response.json({ error: "VISITORS_OFF" }, { status: 404, headers: QUIET });
}

export function visitorDb(request: Request): { closed: Response } | { db: DatabaseSync; ip: string } {
  if (!visitorsEnabled(process.env)) return { closed: visitorsClosed() };
  const engine = getEngine();
  const ip = clientAddress((name) => request.headers.get(name), process.env.LUMEN_TRUSTED_PROXY, publicModeOn());
  return { db: engine.db, ip };
}

/** The token is returned to the caller of this function. Do not log it. */
export function bearerToken(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match?.[1] ?? "";
}

export async function readVisitorJson(request: Request): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; response: Response }> {
  const limited = await readLimitedText(request, WORLD_MAX_BYTES);
  if (!limited.ok) return { ok: false, response: Response.json({ error: "BODY_TOO_LARGE" }, { status: 413, headers: QUIET }) };
  if (!limited.text) return { ok: true, body: {} };
  try {
    const parsed = JSON.parse(limited.text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: true, body: {} };
    return { ok: true, body: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, response: Response.json({ error: "JSON" }, { status: 400, headers: QUIET }) };
  }
}

export function visitorResult(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: QUIET });
}
