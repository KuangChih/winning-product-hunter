// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { proxy } from "@/proxy";
import { getDictionary } from "./dictionaries";
import { isLocale, LOCALE_COOKIE, localizedPath, LOCALES, splitLocale } from "./locales";

describe("locale helpers", () => {
  it("recognizes supported locales only", () => {
    expect(isLocale("en")).toBe(true);
    expect(isLocale("zh-TW")).toBe(true);
    expect(isLocale("zh")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });

  it("splits a leading locale segment off a path", () => {
    expect(splitLocale("/zh-TW/products/x")).toEqual({ locale: "zh-TW", path: "/products/x" });
    expect(splitLocale("/zh-TW")).toEqual({ locale: "zh-TW", path: "/" });
    expect(splitLocale("/products")).toEqual({ locale: null, path: "/products" });
  });

  it("maps unprefixed paths to the cookie's language, defaulting to English", () => {
    expect(localizedPath("/products", "zh-TW")).toBe("/zh-TW/products");
    expect(localizedPath("/", "zh-TW")).toBe("/zh-TW");
    expect(localizedPath("/products", undefined)).toBe("/en/products");
    expect(localizedPath("/products", "fr")).toBe("/en/products");
    expect(localizedPath("/zh-TW/products", "en")).toBeNull();
  });

  it("has every key translated in every language", () => {
    const keys = (o: object, prefix = ""): string[] =>
      Object.entries(o).flatMap(([k, v]) =>
        typeof v === "object" ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
      );
    const strings = (o: object): unknown[] =>
      Object.values(o).flatMap((v) => (typeof v === "object" ? strings(v) : [v]));
    const reference = keys(getDictionary("en")).sort();
    for (const locale of LOCALES) {
      const dict = getDictionary(locale);
      expect(keys(dict).sort()).toEqual(reference);
      expect(strings(dict).every((s) => typeof s === "string" && s.trim() !== "")).toBe(true);
    }
  });
});

describe("proxy language rewrite", () => {
  afterEach(() => vi.unstubAllEnvs());

  const request = (path: string, locale?: string) =>
    new NextRequest(`http://localhost:3000${path}`, {
      headers: locale ? { cookie: `${LOCALE_COOKIE}=${locale}` } : {},
    });
  const rewrittenTo = (res: Response) => {
    const target = res.headers.get("x-middleware-rewrite");
    return target ? new URL(target).pathname + new URL(target).search : null;
  };

  it("rewrites unprefixed URLs to the chosen language and keeps the query", async () => {
    vi.stubEnv("SITE_PASSWORD", "");
    expect(rewrittenTo(await proxy(request("/products?market=US")))).toBe("/en/products?market=US");
    expect(rewrittenTo(await proxy(request("/products", "zh-TW")))).toBe("/zh-TW/products");
    expect(rewrittenTo(await proxy(request("/", "zh-TW")))).toBe("/zh-TW");
  });

  it("leaves prefixed URLs alone", async () => {
    vi.stubEnv("SITE_PASSWORD", "");
    const res = await proxy(request("/zh-TW/products", "en"));
    expect(rewrittenTo(res)).toBeNull();
    expect(res.headers.get("location")).toBeNull();
  });

  it("lets the localized login page through without a session", async () => {
    vi.stubEnv("SITE_PASSWORD", "secret");
    expect((await proxy(request("/zh-TW/login"))).headers.get("location")).toBeNull();
    expect(rewrittenTo(await proxy(request("/login", "zh-TW")))).toBe("/zh-TW/login");
  });
});
