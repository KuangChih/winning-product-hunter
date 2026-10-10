import { NextResponse, type NextRequest } from "next/server";
import { isValidSiteToken, SITE_AUTH_COOKIE, sitePassword } from "@/lib/site-auth";

/** Gate every page behind SITE_PASSWORD when it is set (ADR-008); open otherwise. */
export async function proxy(request: NextRequest) {
  const password = sitePassword();
  if (!password) return NextResponse.next();
  if (request.nextUrl.pathname === "/login") return NextResponse.next();

  if (await isValidSiteToken(request.cookies.get(SITE_AUTH_COOKIE)?.value, password)) {
    return NextResponse.next();
  }
  const login = new URL("/login", request.url);
  login.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(login);
}

export const config = {
  // Everything except static assets, image optimization and robots.txt (crawlers must be able
  // to read "Disallow: /" without signing in).
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)",
  ],
};
