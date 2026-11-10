import { OWNER_COOKIE, readCookie, safeEqual, sessionValid } from "../../../auth/owner";
import { clientAddress } from "../../../auth/owner";
import { publicModeOn } from "../../../auth/publicMode";
import { allowOwnerToken, distinctBearerBlocked, noteDistinctBearerMiss, noteOwnerTokenFailure, ownerTokenKey, ownerTokenLocked } from "../../../auth/ownerToken";
import { logSecurity } from "../../../http/log";
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
    if (expected && safeEqual(token, expected)) return { ok: true };
    const ip = clientAddress((name) => request.headers.get(name), process.env.LUMEN_TRUSTED_PROXY, publicModeOn());
    if (distinctBearerBlocked(ip, now) || ownerTokenLocked(key, now) || !allowOwnerToken(key, now)) {
      logSecurity({ event: "rate_limited", status: 429, route: "/api/checkout" });
      return { ok: false, status: 429, error: "RATE" };
    }
    noteOwnerTokenFailure(key, now);
    noteDistinctBearerMiss(ip, key, now);
    return { ok: false, status: 401, error: "UNAUTHORIZED" };
  }
  if (sessionValid(engine.db, readCookie(request.headers.get("cookie"), OWNER_COOKIE), now)) return { ok: true };
  return { ok: false, status: 401, error: "UNAUTHORIZED" };
}

