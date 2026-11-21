import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { clientAddress } from "./auth/address";
import { allowPage, limitedPage } from "./auth/pageLimit";
import { contentSecurityPolicy, publicModeOn } from "./auth/publicMode";

const APEX = "https://zoora.ai";

function hostname(host: string | null): string {
  const raw = (host ?? "").trim().toLowerCase();
  if (raw.startsWith("[")) {
    const end = raw.indexOf("]");
    return end > 1 ? raw.slice(1, end) : "";
  }
  return raw.split(":")[0] ?? "";
}

/**
 * www goes to the apex. Old .html addresses fold onto the app routes.
 * The base is always https://zoora.ai. X-Forwarded-Host and X-Forwarded-Proto do not choose it.
 */
/** The island lives at /. /world keeps the camera query and does not publish a second canonical. */
export function worldHomeRedirect(pathname: string, search = ""): string | null {
  if (pathname !== "/world") return null;
  return `/${search}`;
}

export function publicRedirect(host: string | null, pathname: string, search = "", forwardedHost: string | null = null, forwardedProto: string | null = null): string | null {
  void forwardedHost;
  void forwardedProto;
  const name = hostname(host);
  let path = pathname || "/";
  const html = path === "/index.html" || path === "/success.html";
  if (path === "/index.html") path = "/";
  if (path === "/success.html") path = "/success";
  if (name !== "www.zoora.ai" && !html) return null;
  return new URL(`${path}${search}`, APEX).href;
}

function pageNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let raw = "";
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw);
}

export function middleware(request: NextRequest) {
  const target = publicRedirect(
    request.headers.get("host"),
    request.nextUrl.pathname,
    request.nextUrl.search,
    request.headers.get("x-forwarded-host"),
    request.headers.get("x-forwarded-proto"),
  );
  if (target) return NextResponse.redirect(target, 301);
  if (worldHomeRedirect(request.nextUrl.pathname, request.nextUrl.search)) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url, 307);
  }
  if (request.nextUrl.pathname.startsWith("/api/delivery/")) {
    const response = NextResponse.next();
    response.headers.set("Content-Security-Policy", "sandbox");
    return response;
  }
  const nonce = pageNonce();
  const policy = contentSecurityPolicy(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("x-lumen-path", request.nextUrl.pathname);
  requestHeaders.set("content-security-policy", policy);
  if (publicModeOn() && request.nextUrl.pathname !== "/api/world/here") {
    const ip = clientAddress((name) => request.headers.get(name), process.env.LUMEN_TRUSTED_PROXY, true);
    if (!allowPage(ip, Date.now())) return limitedPage();
  }
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/health|healthz).*)"],
};
