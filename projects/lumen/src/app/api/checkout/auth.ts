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

/**
 * Where Stripe sends a buyer after checkout. The request's Origin header is the caller's own claim,
 * so it is used only when it is one of this site's origins. Anything else gets the configured origin.
 */
export function checkoutReturnOrigin(origin: string | null, env: Record<string, string | undefined> = process.env): string {
  const configured = (env.LUMEN_ORIGIN ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  const local = !publicModeOn(env);
  const fallback = configured[0] ?? (local ? "http://localhost:3000" : PUBLIC_ORIGINS[0]!);
  if (!origin) return fallback;
  try {
    const got = new URL(origin);
    const known = [...PUBLIC_ORIGINS, ...configured].some((item) => {
      try {
        return new URL(item).origin === got.origin;
      } catch {
        return false;
      }
    });
    if (known) return got.origin;
    if (local && (got.hostname === "localhost" || got.hostname === "127.0.0.1")) return got.origin;
  } catch {
    return fallback;
  }
  return fallback;
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
  if (publicModeOn() && (request.headers.get("fly-client-ip") ?? "").trim()) {
    return { ok: false, status: 401, error: "UNAUTHORIZED" };
  }
  if (sessionValid(engine.db, readCookie(request.headers.get("cookie"), OWNER_COOKIE), now)) return { ok: true };
  return { ok: false, status: 401, error: "UNAUTHORIZED" };
}

