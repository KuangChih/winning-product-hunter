// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ingestionRuns, products, sourceItems } from "@/db/schema";
import { createTestDb } from "@/db/testing/pglite";
import { forProducts } from "../collect-for-products";
import { runIngestion } from "../run";
import {
  AdLibraryBlockedError,
  advertiserTarget,
  buildPageUrl,
  buildSearchUrl,
  createAdLibraryWebAdapter,
  parseAdLibraryHtml,
  toFetchedItems,
  USER_AGENT,
} from "./meta-ad-library-web";

const html = fs.readFileSync(
  path.resolve(__dirname, "__recordings__/meta-ad-library-search.html"),
  "utf8",
);

describe("parseAdLibraryHtml (recorded real page, trimmed)", () => {
  it("extracts the result count and ads from the embedded JSON", () => {
    const search = parseAdLibraryHtml(html);
    expect(search.count).toBe(1700);
    expect(search.hasNextPage).toBe(true);
    expect(search.ads.map((a) => a.ad_archive_id)).toEqual([
      "2275498076149743",
      "948652557092896",
      "2156628085281307",
    ]);
  });

  it("maps ads to items with start date, variants, advertiser and landing page", () => {
    const items = toFetchedItems(parseAdLibraryHtml(html), "posture corrector", "US");
    const ad = items[0];
    expect(ad).toMatchObject({
      externalId: "2275498076149743",
      kind: "ad",
      countries: ["US"],
      advertiserId: "142196802302158",
      advertiserName: "Axzenia",
      format: "video",
      endedAt: null,
      url: "https://www.facebook.com/ads/library/?id=2275498076149743",
    });
    expect(ad.startedAt?.toISOString()).toBe("2024-10-31T07:00:00.000Z");
    expect(ad.metrics).toContainEqual({ metric: "creative_variants", value: 2 });
    expect(ad.raw).toMatchObject({
      landing_url: "https://axzenia.com/products/instant-posture-corrector",
      landing_domain: "axzenia.com",
    });
    expect(items.at(-1)).toMatchObject({
      externalId: "ad-library-results|posture corrector|US",
      kind: "trend",
      metrics: [{ metric: "active_ads", value: 1700 }],
    });
  });

  it("stops on CAPTCHA, login pages or missing data instead of trying to get around them", () => {
    const captcha = html.replace(
      '"xfb_ad_library_is_captcha_required":false',
      '"xfb_ad_library_is_captcha_required":true',
    );
    expect(() => parseAdLibraryHtml(captcha)).toThrow(/CAPTCHA/);
    expect(() => parseAdLibraryHtml("<html><title>Log in to Facebook</title></html>")).toThrow(
      AdLibraryBlockedError,
    );
    expect(() => parseAdLibraryHtml("<html></html>")).toThrow(/results_not_embedded/);
  });
});

describe("buildSearchUrl", () => {
  it("searches active ads by keyword in one country", () => {
    const url = new URL(buildSearchUrl("posture corrector", "GB"));
    expect(url.searchParams.get("q")).toBe("posture corrector");
    expect(url.searchParams.get("country")).toBe("GB");
    expect(url.searchParams.get("active_status")).toBe("active");
  });
});

describe("Ad Library web adapter", () => {
  let t: Awaited<ReturnType<typeof createTestDb>>;
  beforeEach(async () => {
    t = await createTestDb();
  });
  afterEach(async () => {
    await t.close();
  });

  it("sends an honest User-Agent, respects the request cap and attaches ads to the product", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(html));
    const [product] = await t.db
      .insert(products)
      .values({ slug: "posture", title: "Posture Corrector", firstSeenAt: new Date() })
      .returning();

    const adapter = forProducts(
      createAdLibraryWebAdapter({
        countries: ["US", "CA", "GB"],
        maxRequests: 2,
        retry: { fetchImpl },
      }),
      [{ productId: product.id, query: product.title }],
    );
    const result = await runIngestion(t.db, adapter, { queries: [], limit: 100 });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const headers = new Headers(fetchImpl.mock.calls[0][1]?.headers);
    expect(headers.get("User-Agent")).toBe(USER_AGENT);
    expect(result).toMatchObject({ status: "succeeded", itemsFetched: 8 });
    const items = await t.db.select().from(sourceItems);
    expect(items.every((i) => i.productId === product.id)).toBe(true);
    expect(items.find((i) => i.kind === "ad")?.provider).toBe("ad_library_web");
  });

  it("records a failed run when Meta blocks the request", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response("<html><title>Log in to Facebook</title></html>"),
    );
    const adapter = createAdLibraryWebAdapter({ countries: ["US"], retry: { fetchImpl } });

    const result = await runIngestion(t.db, adapter, { queries: ["x"], limit: 10 });

    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/\[login_wall\]/);
    const [run] = await t.db.select().from(ingestionRuns);
    expect(run.status).toBe("failed");
  });

  it("follows advertisers: one page view per advertiser and country, no keyword summary", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(html));
    const adapter = createAdLibraryWebAdapter({
      mode: "advertiser",
      countries: ["US", "CA"],
      retry: { fetchImpl },
    });
    const items = [];
    for await (const item of adapter.fetch({
      queries: [
        advertiserTarget("445474685326237", "GB"),
        "not-a-target",
        advertiserTarget("1", "US"),
      ],
      limit: 1000,
    })) {
      items.push(item);
    }

    // Invalid targets are skipped; each target is fetched once, in its own country only.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const first = new URL(String(fetchImpl.mock.calls[0][0]));
    expect(first.searchParams.get("view_all_page_id")).toBe("445474685326237");
    expect(first.searchParams.get("search_type")).toBe("page");
    expect(first.searchParams.get("country")).toBe("GB");
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.kind === "ad")).toBe(true);
  });
});

describe("buildPageUrl", () => {
  it("opens one advertiser's active ads in one country", () => {
    const url = new URL(buildPageUrl("123", "AU"));
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      active_status: "active",
      country: "AU",
      view_all_page_id: "123",
      search_type: "page",
    });
  });
});
