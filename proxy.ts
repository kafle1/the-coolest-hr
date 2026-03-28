import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { verifySessionToken } from "@/lib/auth/session-token";

const COOKIE_NAME = "admin_session";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === "/admin/login" || pathname.startsWith("/api/admin/auth")) {
    return NextResponse.next();
  }

  const token = request.cookies.get(COOKIE_NAME)?.value;
  const email = token ? await verifySessionToken(token) : null;

  if (!email) {
    if (pathname.startsWith("/api/admin")) {
      return NextResponse.json(
        { ok: false, message: "Authentication required." },
        { status: 401 },
      );
    }

    const loginUrl = new URL("/admin/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};