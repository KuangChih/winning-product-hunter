// @vitest-environment node
// The docs call it unstable_doesProxyMatch; this Next.js version still exports the old name.
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import nextConfig from "../../next.config";
import { config, proxy } from "@/proxy";
import { SECURITY_HEADERS } from "./security-headers";
import { safeEqual, safeNextPath, SITE_AUTH_COOKIE, siteToken } from "./site-auth";

describe("site auth helpers", () => {
  it("derives a stable token that changes with the password", async () => {
    const a = await siteToken("secret");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await siteToken("secret")).toBe(a);
    expect(await siteToken("other")).not.toBe(a);
  });

  it("compares strings safely", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });

  it("only allows same-site relative redirects after login", () => {
    expect(safeNextPath("/products?market=US")).toBe("/products?market=US");
    expect(safeNextPath("https://evil.example")).toBe("/");
    expect(safeNextPath("//evil.example")).toBe("/");
    expect(safeNextPath("/\\evil.example")).toBe("/");
    expect(safeNextPath("/login?next=/x")).toBe("/");
    expect(safeNextPath(undefined)).toBe("/");
  });
});

describe("proxy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const request = (path: string, cookie?: string) =>
    new NextRequest(`http://localhost:3000${path}`, {
      headers: cookie ? { cookie: `${SITE_AUTH_COOKIE}=${cookie}` } : {},
    });

  it("lets everything through when no site password is set", async () => {
    vi.stubEnv("SITE_PASSWORD", "");
    const res = await proxy(request("/products"));
    expect(res.headers.get("location")).toBeNull();
  });

  it("redirects to login with the original path when the cookie is missing or wrong", async () => {
    vi.stubEnv("SITE_PASSWORD", "secret");
    for (const cookie of [undefined, "nope"]) {
      const res = await proxy(request("/products?market=US", cookie));
      expect(res.status).toBe(307);
      const location = new URL(res.headers.get("location")!);
      expect(location.pathname).toBe("/login");
      expect(location.searchParams.get("next")).toBe("/products?market=US");
    }
  });

  it("allows the login page and requests with a valid cookie", async () => {
    vi.stubEnv("SITE_PASSWORD", "secret");
    expect((await proxy(request("/login"))).headers.get("location")).toBeNull();
    const ok = await proxy(request("/products", await siteToken("secret")));
    expect(ok.headers.get("location")).toBeNull();
  });
});

describe("proxy matcher", () => {
  const matches = (url: string) => unstable_doesMiddlewareMatch({ config, nextConfig, url });

  it("guards pages and server actions but not static files or robots.txt", () => {
    expect(matches("/")).toBe(true);
    expect(matches("/products/ear-cleaner")).toBe(true);
    expect(matches("/watchlist")).toBe(true);
    expect(matches("/robots.txt")).toBe(false);
    expect(matches("/_next/static/chunks/app.js")).toBe(false);
    expect(matches("/favicon.ico")).toBe(false);
  });
});

describe("security headers", () => {
  it("apply to every route, deny framing and ask not to be indexed", async () => {
    const rules = await nextConfig.headers!();
    expect(rules).toEqual([{ source: "/:path*", headers: SECURITY_HEADERS }]);
    const byKey = Object.fromEntries(SECURITY_HEADERS.map((h) => [h.key, h.value]));
    expect(byKey["X-Frame-Options"]).toBe("DENY");
    expect(byKey["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(byKey["X-Content-Type-Options"]).toBe("nosniff");
    expect(byKey["X-Robots-Tag"]).toContain("noindex");
    expect(nextConfig.poweredByHeader).toBe(false);
  });
});
