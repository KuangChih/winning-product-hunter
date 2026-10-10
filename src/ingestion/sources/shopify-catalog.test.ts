// @vitest-environment node
import { eq, isNull } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { products, sourceItems } from "@/db/schema";
import { createTestDb } from "@/db/testing/pglite";
import { runMatching } from "@/matching/run";
import { forProducts } from "../collect-for-products";
import { runIngestion } from "../run";
import recording from "./__recordings__/shopify-catalog-search.json";
import {
  buildSearchRequest,
  type CatalogSearchResponse,
  createShopifyCatalogAdapter,
  parseCatalogSearch,
  SHOPIFY_CATALOG_ENDPOINT,
  ShopifyCatalogError,
} from "./shopify-catalog";

const res = recording as unknown as CatalogSearchResponse;

describe("parseCatalogSearch (recorded real response)", () => {
  it("maps products to per-country store items with retail price, seller and rating", () => {
    const items = parseCatalogSearch(res, "dog paw cleaner cup", "US");
    const productsOnly = items.filter((i) => i.kind === "store_product");

    expect(productsOnly).toHaveLength(3);
    expect(productsOnly[0]).toMatchObject({
      externalId: "gid://shopify/p/58F5YAD4kNMY3u29KBjlIj|US",
      title: "Medium Paw Cleaner Cup for Dogs & Cats in Black",
      countries: ["US"],
      priceCents: 1999,
      currency: "USD",
      advertiserId: "bugalugs-pet-care.myshopify.com",
      advertiserName: "Bugalugs Pet Care",
    });
    expect(productsOnly[0].metrics).toEqual([
      { metric: "selling_stores", value: 1 },
      { metric: "rating", value: 4.3 },
      { metric: "rating_count", value: 22 },
    ]);
  });

  it("adds a keyword-level item with the number of matching catalog products", () => {
    const supply = parseCatalogSearch(res, "Dog Paw Cleaner Cup", "US").at(-1)!;
    expect(supply).toMatchObject({
      externalId: "catalog-results|dog paw cleaner cup|US",
      kind: "trend",
      metrics: [{ metric: "catalog_results", value: 398 }],
    });
  });

  it("throws on JSON-RPC errors", () => {
    expect(() =>
      parseCatalogSearch(
        { jsonrpc: "2.0", id: 1, error: { code: -32602, message: "bad profile" } },
        "x",
        "US",
      ),
    ).toThrow(ShopifyCatalogError);
  });
});

describe("buildSearchRequest", () => {
  it("puts the agent profile in meta and filters by ship-to country", () => {
    const body = buildSearchRequest({ query: "q", country: "GB", limit: 20, profile: "https://p" });
    expect(body.params.arguments.meta).toEqual({ "ucp-agent": { profile: "https://p" } });
    expect(body.params.arguments.catalog.filters.ships_to).toEqual({ country: "GB" });
    expect(body.params.arguments.catalog.pagination).toEqual({ limit: 20 });
  });
});

describe("Shopify Catalog adapter", () => {
  let t: Awaited<ReturnType<typeof createTestDb>>;
  beforeEach(async () => {
    t = await createTestDb();
  });
  afterEach(async () => {
    await t.close();
  });

  it("searches each product in each country and attaches results to that product", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json(res));
    const [product] = await t.db
      .insert(products)
      .values({ slug: "paw", title: "Silicone Dog Paw Cleaner Cup", firstSeenAt: new Date() })
      .returning();

    const adapter = forProducts(
      createShopifyCatalogAdapter({ countries: ["US", "GB"], retry: { fetchImpl } }),
      [{ productId: product.id, query: product.title }],
    );
    const result = await runIngestion(t.db, adapter, { queries: [], limit: 100 });

    expect(result).toMatchObject({ status: "succeeded", itemsFetched: 8 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [url, init] = fetchImpl.mock.calls[1];
    expect(url).toBe(SHOPIFY_CATALOG_ENDPOINT);
    expect(JSON.parse(String(init?.body)).params.arguments.catalog.filters.ships_to).toEqual({
      country: "GB",
    });

    const attached = await t.db
      .select()
      .from(sourceItems)
      .where(eq(sourceItems.productId, product.id));
    expect(attached).toHaveLength(8);
    expect(await t.db.select().from(sourceItems).where(isNull(sourceItems.productId))).toEqual([]);
    // Entity resolution leaves pre-assigned items alone instead of creating new products.
    expect(await runMatching(t.db)).toEqual({
      productsCreated: 0,
      itemsMatched: 0,
      itemsUnmatched: 0,
    });
  });
});

describe("Global Catalog lookup of advertisers' product pages (recorded real response)", () => {
  it("resolves landing URLs to the advertiser's own price, rating and reviews", async () => {
    const lookup = (await import("./__recordings__/shopify-catalog-lookup.json")).default;
    const { parseCatalogLookup, buildLookupRequest } = await import("./shopify-catalog");
    const items = parseCatalogLookup(lookup as unknown as CatalogSearchResponse, "US");

    expect(items).toHaveLength(2);
    const core = items.find((i) => i.advertiserName === "Corecare")!;
    expect(core).toMatchObject({
      kind: "store_product",
      priceCents: 6490,
      currency: "USD",
      countries: ["US"],
      raw: expect.objectContaining({ advertised: true }),
    });
    expect(core.metrics).toContainEqual({ metric: "rating_count", value: 212 });

    const body = buildLookupRequest({
      urls: Array.from({ length: 60 }, (_, i) => `https://s.com/products/p${i}`),
      country: "GB",
      profile: "https://p",
    });
    expect(body.params.name).toBe("lookup_catalog");
    expect(body.params.arguments.catalog.ids).toHaveLength(50);
    expect(body.params.arguments.catalog.context).toEqual({ address_country: "GB" });
  });

  describe("stored next to search results", () => {
    let t: Awaited<ReturnType<typeof createTestDb>>;
    beforeEach(async () => {
      t = await createTestDb();
    });
    afterEach(async () => {
      await t.close();
    });

    it("a search returning the advertiser's product keeps the own-listing row and price", async () => {
      const lookup = (await import("./__recordings__/shopify-catalog-lookup.json")).default;
      const { createStoreLookupAdapter } = await import("./shopify-catalog");
      // The search response returns the very same catalog products (same ids, same country).
      const fetchImpl = vi.fn<typeof fetch>(async () => Response.json(lookup));
      await runIngestion(t.db, createStoreLookupAdapter({ country: "US", retry: { fetchImpl } }), {
        queries: ["https://s.com/products/a"],
        limit: 100,
      });
      await runIngestion(
        t.db,
        createShopifyCatalogAdapter({ countries: ["US"], retry: { fetchImpl } }),
        { queries: ["posture corrector"], limit: 100 },
      );

      const rows = await t.db.select().from(sourceItems);
      const own = rows.filter((r) => r.provider === "shopify_catalog_lookup");
      const search = rows.filter((r) => r.provider === "shopify_catalog");
      expect(own).toHaveLength(2);
      expect(search).toHaveLength(2);
      expect(own.every((r) => r.externalId.startsWith("lookup|"))).toBe(true);
      expect(own.find((r) => r.advertiserName === "Corecare")).toMatchObject({
        priceCents: 6490,
        raw: expect.objectContaining({ advertised: true }),
      });
      expect(search.map((r) => `lookup|${r.externalId}`).sort()).toEqual(
        own.map((r) => r.externalId).sort(),
      );
    });
  });
});
