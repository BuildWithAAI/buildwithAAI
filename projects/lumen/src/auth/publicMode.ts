import type { Env } from "../money/rules";

export function publicModeOn(env: Env = process.env): boolean {
  return env.LUMEN_PUBLIC_MODE === "true";
}

/** Owner, desk, and ledger pages stay closed until a session exists. Login itself stays open. */
export function ownerRouteOpen(path: string, authed: boolean, env: Env = process.env): boolean {
  if (!publicModeOn(env)) return true;
  const clean = path.split("?")[0] ?? "/";
  if (clean === "/admin/login") return true;
  if (clean === "/admin" || clean.startsWith("/admin/")) return authed;
  return true;
}

/** Sent on every response. Next bakes these at build time, so they cannot depend on a runtime flag. */
export function securityHeaders(_publicMode?: boolean): { key: string; value: string }[] {
  return [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "no-referrer" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-DNS-Prefetch-Control", value: "off" },
    { key: "Content-Security-Policy", value: "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" },
    { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  ];
}
