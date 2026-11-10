import type { Env } from "../money/rules";

export function publicModeOn(env: Env = process.env): boolean {
  return (env.LUMEN_PUBLIC_MODE ?? "").trim().toLowerCase() === "true";
}

/** Owner, desk, and ledger pages stay closed until a session exists. The public login page stays closed too. */
export function ownerRouteOpen(path: string, authed: boolean, env: Env = process.env): boolean {
  if (!publicModeOn(env)) return true;
  const clean = path.split("?")[0] ?? "/";
  if (clean === "/admin" || clean.startsWith("/admin/")) return authed;
  return true;
}

/**
 * Public mode closes the login form and the login action on the public edge.
 * Fly sets Fly-Client-IP on public requests. A direct `fly proxy 3000` connection does not.
 * The Host header is not consulted.
 */
export function loginReachable(flyClientIp: string | null, env: Env = process.env): boolean {
  if (!publicModeOn(env)) return true;
  return !(flyClientIp ?? "").trim();
}

export function privateDeskHost(host: string | null): boolean {
  const name = deskHostname(host);
  if (name === "localhost" || name === "127.0.0.1" || name === "::1") return true;
  return name.endsWith(".internal");
}

function deskHostname(host: string | null): string {
  const raw = (host ?? "").trim().toLowerCase();
  if (raw.startsWith("[")) {
    const end = raw.indexOf("]");
    return end > 1 ? raw.slice(1, end) : "";
  }
  return raw.split(":")[0] ?? "";
}

/** Sent on every response. Next bakes these at build time, so they cannot depend on a runtime flag. */
export function securityHeaders(_publicMode?: boolean): { key: string; value: string }[] {
  return [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "no-referrer" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-DNS-Prefetch-Control", value: "off" },
    { key: "Content-Security-Policy", value: "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://app.kit.com" },
    { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  ];
}
