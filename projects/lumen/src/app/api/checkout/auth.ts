import { OWNER_COOKIE, readCookie, safeEqual, sessionValid } from "../../../auth/owner";
import { allowOwnerToken, noteOwnerTokenFailure, ownerTokenKey, ownerTokenLocked } from "../../../auth/ownerToken";
import { getEngine } from "../../../server/engine";

const PUBLIC_ORIGINS = ["https://zoora.ai", "https://world.zoora.ai"];

export function originAllowed(origin: string | null, env: Record<string, string | undefined> = process.env): boolean {
  if (!origin) return true;
  const configured = (env.LUMEN_ORIGIN ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  const allowed = [...PUBLIC_ORIGINS, ...configured];
  try {
    const got = new URL(origin).origin;
    return allowed.some((item) => {
      try {
        return new URL(item).origin === got;
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

export function checkoutAuth(request: Request, now = Date.now()): { ok: true } | { ok: false; status: number; error: string } {
  const origin = request.headers.get("origin");
  if (!originAllowed(origin)) return { ok: false, status: 403, error: "ORIGIN" };
  const engine = getEngine();
  const token = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
  const expected = engine.env.OWNER_ACCESS_TOKEN ?? "";
  if (token) {
    const key = ownerTokenKey(token);
    if (ownerTokenLocked(key, now) || !allowOwnerToken(key, now)) return { ok: false, status: 429, error: "RATE" };
    if (expected && safeEqual(token, expected)) return { ok: true };
    noteOwnerTokenFailure(key, now);
    return { ok: false, status: 401, error: "UNAUTHORIZED" };
  }
  if (sessionValid(engine.db, readCookie(request.headers.get("cookie"), OWNER_COOKIE), now)) return { ok: true };
  return { ok: false, status: 401, error: "UNAUTHORIZED" };
}

