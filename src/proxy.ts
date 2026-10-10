import { NextResponse, type NextRequest } from "next/server";
import { LOCALE_COOKIE, localizedPath, splitLocale } from "@/i18n/locales";
import { isValidSiteToken, SITE_AUTH_COOKIE, sitePassword } from "@/lib/site-auth";

/**
 * 1. Gate every page behind SITE_PASSWORD when it is set (ADR-008); open otherwise.
 * 2. Serve unprefixed URLs in the visitor's language by rewriting to `/[lang]/...` (ADR-011).
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  const password = sitePassword();
  if (
    password &&
    splitLocale(pathname).path !== "/login" &&
    !(await isValidSiteToken(request.cookies.get(SITE_AUTH_COOKIE)?.value, password))
  ) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", pathname + search);
    return NextResponse.redirect(login);
  }

  const target = localizedPath(pathname, request.cookies.get(LOCALE_COOKIE)?.value);
  if (!target) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = target;
  return NextResponse.rewrite(url);
}

export const config = {
  // Everything except static assets, image optimization and robots.txt (crawlers must be able
  // to read "Disallow: /" without signing in).
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)",
  ],
};
