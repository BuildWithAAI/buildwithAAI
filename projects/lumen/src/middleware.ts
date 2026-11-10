import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { clientAddress } from "./auth/address";
import { allowPage, limitedPage } from "./auth/pageLimit";
import { publicModeOn } from "./auth/publicMode";

export function middleware(request: NextRequest) {
  if (!publicModeOn()) return NextResponse.next();
  const ip = clientAddress((name) => request.headers.get(name), process.env.LUMEN_TRUSTED_PROXY, true);
  if (!allowPage(ip, Date.now())) return limitedPage();
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/health|healthz).*)"],
};
