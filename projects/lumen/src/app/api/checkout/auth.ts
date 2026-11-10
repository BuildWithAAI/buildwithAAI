import { OWNER_COOKIE, readCookie, safeEqual, sessionValid } from "../../../auth/owner";
import { allowOwnerToken, noteOwnerTokenFailure, ownerTokenLocked } from "../../../auth/ownerToken";
import { getEngine } from "../../../server/engine";

export function checkoutAuth(request: Request, now = Date.now()): { ok: true } | { ok: false; status: number; error: string } {
  const origin = request.headers.get("origin");
  const allowed = process.env.LUMEN_ORIGIN || "https://zoora.ai";
  if (origin && !sameOrigin(origin, allowed)) return { ok: false, status: 403, error: "ORIGIN" };
  const engine = getEngine();
  const token = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
  const expected = engine.env.OWNER_ACCESS_TOKEN ?? "";
  if (token) {
    const key = `bearer:${token.slice(0, 12)}`;
    if (ownerTokenLocked(key, now) || !allowOwnerToken(key, now)) return { ok: false, status: 429, error: "RATE" };
    if (expected && safeEqual(token, expected)) return { ok: true };
    noteOwnerTokenFailure(key, now);
    return { ok: false, status: 401, error: "UNAUTHORIZED" };
  }
  if (sessionValid(engine.db, readCookie(request.headers.get("cookie"), OWNER_COOKIE), now)) return { ok: true };
  return { ok: false, status: 401, error: "UNAUTHORIZED" };
}

function sameOrigin(origin: string, allowed: string): boolean {
  try {
    return new URL(origin).origin === new URL(allowed).origin;
  } catch {
    return false;
  }
}
