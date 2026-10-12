import { describe, expect, it, vi } from "vitest";
import { createRedirectResolver, robotsAllows, STORE_PAGES_USER_AGENT } from "./store-redirect";

describe("robotsAllows", () => {
  // The usual Shopify robots.txt keeps product pages open.
  const shopify = [
    "User-agent: *",
    "Disallow: /admin",
    "Disallow: /cart",
    "Disallow: /collections/*sort_by*",
    "Disallow: /*/collections/*+*",
    "Disallow: /products/*.oembed$",
    "",
    "User-agent: adsbot-google",
    "Disallow: /",
  ].join("\n");

  it("follows the * group, longest rule wins, wildcards and $", () => {
    expect(robotsAllows(shopify, "/products/neck-fan")).toBe(true);
    expect(robotsAllows(shopify, "/products/neck-fan.oembed")).toBe(false);
    expect(robotsAllows(shopify, "/admin/x")).toBe(false);
    expect(robotsAllows("User-agent: *\nDisallow: /\nAllow: /products/", "/products/a")).toBe(true);
    expect(robotsAllows("User-agent: *\nDisallow: /", "/products/a")).toBe(false);
    // Another crawler's group does not apply; consecutive agent lines share a group.
    expect(robotsAllows("User-agent: x\nDisallow: /", "/products/a")).toBe(true);
    expect(robotsAllows("User-agent: x\nUser-agent: *\nDisallow: /p", "/products/a")).toBe(false);
    expect(robotsAllows("", "/anything")).toBe(true);
  });
});

describe("createRedirectResolver", () => {
  const robots = (body: string) => new Response(body, { status: 200 });
  const landed = (url: string, status = 200) => {
    const r = new Response(null, { status });
    Object.defineProperty(r, "url", { value: url });
    return r;
  };

  it("reads robots.txt once per store, sends HEAD with an honest UA and keeps only the final URL", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/robots.txt")) return robots("User-agent: *\nDisallow: /cart");
      expect(init?.method).toBe("HEAD");
      expect((init?.headers as Record<string, string>)["User-Agent"]).toBe(STORE_PAGES_USER_AGENT);
      return url.includes("old-handle")
        ? landed("https://paw-friend.com/products/new-handle?variant=1")
        : landed(url);
    });
    const wait = vi.fn(async () => {});
    const resolve = createRedirectResolver({ fetchImpl, wait });
    expect(await resolve("https://shop.example/products/old-handle")).toEqual({
      url: "https://shop.example/products/old-handle",
      outcome: "redirected",
      finalUrl: "https://paw-friend.com/products/new-handle",
      status: 200,
    });
    expect(await resolve("https://shop.example/products/same")).toMatchObject({ outcome: "same" });
    // robots.txt + 2 pages, every request paced.
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenCalledTimes(3);
  });

  it("respects robots.txt, falls back to GET when HEAD is refused, and reports blocks", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      calls.push(`${init?.method} ${url}`);
      if (url === "https://closed.example/robots.txt") return robots("User-agent: *\nDisallow: /");
      // A lapsed store's domain forwards everything, robots.txt included, to a refusing site.
      if (url.startsWith("https://lapsed.example")) {
        return landed("https://domains-for-sale.example/names/lapsed", 403);
      }
      if (url.endsWith("/robots.txt")) return robots("");
      if (url.startsWith("https://nohead.example")) {
        return init?.method === "HEAD" ? landed(url, 405) : landed(url);
      }
      if (url.startsWith("https://angry.example")) return landed(url, 429);
      if (url.startsWith("https://lapsed.example")) {
        return landed("https://domains-for-sale.example/names/lapsed", 403);
      }
      return landed(url, 404);
    });
    const resolve = createRedirectResolver({ fetchImpl, wait: async () => {} });
    expect(await resolve("https://closed.example/products/a")).toMatchObject({
      outcome: "disallowed",
    });
    expect(calls).toEqual(["GET https://closed.example/robots.txt"]);
    expect(await resolve("https://nohead.example/products/a")).toMatchObject({ outcome: "same" });
    expect(await resolve("https://angry.example/products/a")).toMatchObject({
      outcome: "blocked",
      status: 429,
    });
    // A refusal by another site the dead store forwards to is not the store blocking us.
    expect(await resolve("https://lapsed.example/products/a")).toMatchObject({
      outcome: "error",
      status: 403,
    });
    expect(await resolve("https://gone.example/products/a")).toMatchObject({
      outcome: "not_found",
    });
  });
});
