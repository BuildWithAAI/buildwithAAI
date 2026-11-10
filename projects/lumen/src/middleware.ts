import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { clientAddress } from "./auth/address";
import { allowPage, limitedPage } from "./auth/pageLimit";
import { publicModeOn } from "./auth/publicMode";

const APEX = "https://zoora.ai";

/** www.zoora.ai goes to the apex and keeps the path. Old .html addresses fold onto the app routes. */
export function publicRedirect(host: string | null, pathname: string, search = ""): string | null {
  const name = (host ?? "").trim().toLowerCase().split(":")[0] ?? "";
  let path = pathname || "/";
  if (path === "/index.html") path = "/";
  if (path === "/success.html") path = "/success";
  if (name === "www.zoora.ai") return `${APEX}${path}${search}`;
  if (path !== pathname) return `${path}${search}`;
  return null;
}

export function middleware(request: NextRequest) {
  const target = publicRedirect(request.headers.get("host"), request.nextUrl.pathname, request.nextUrl.search);
  if (target) return NextResponse.redirect(new URL(target, request.url), 301);
  if (!publicModeOn()) return NextResponse.next();
  const ip = clientAddress((name) => request.headers.get(name), process.env.LUMEN_TRUSTED_PROXY, true);
  if (!allowPage(ip, Date.now())) return limitedPage();
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/health|healthz).*)"],
};
