// @vitest-environment node
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectionAttempts, products, sourceItems, watchlist } from "@/db/schema";
import { createTestDb } from "@/db/testing/pglite";
import { sameProductAdsOnly } from "@/jobs/collect";
import { repairAdAttachments, repairProductImages, repairStoreListings } from "./repair";
import { runMatching } from "./run";

const NOW = new Date("2026-10-10T00:00:00Z");
const url = (handle: string) => `https://store.example/products/${handle}`;

describe("repairAdAttachments", () => {
  let t: Awaited<ReturnType<typeof createTestDb>>;
  let n = 0;
  beforeEach(async () => {
    t = await createTestDb();
  });
  afterEach(async () => {
    await t.close();
  });

  async function product(slug: string, landingKey: string | null) {
    const [p] = await t.db
      .insert(products)
      .values({ slug, title: slug, landingKey, firstSeenAt: NOW })
      .returning();
    return p.id;
  }
  async function ad(productId: string, landing: string | null, provider = "ad_library_web") {
    const [i] = await t.db
      .insert(sourceItems)
      .values({
        source: "meta_ads",
        provider,
        externalId: `ad-${n++}`,
        kind: "ad",
        productId,
        firstSeenAt: NOW,
        lastSeenAt: NOW,
        raw: { landing_url: landing },
      })
      .returning();
    return i.id;
  }
  const productOf = async (id: string) =>
    (await t.db.select().from(sourceItems).where(eq(sourceItems.id, id)))[0]?.productId;

  it("keeps ads on their own page, moves others to the right product and drops the rest", async () => {
    const a = await product("a", "handle:a");
    const b = await product("b", "handle:b");
    const sample = await product("led-mask", null);
    await ad(sample, null, "fixture");
    const keep = await ad(a, url("a"));
    const toB = await ad(a, url("b"));
    const toA = await ad(sample, url("a"));
    const drop = await ad(a, url("unknown"));
    const empty = await product("only-wrong-ads", "handle:x");
    await ad(empty, url("nowhere"));
    const watched = await product("watched", "handle:w");
    await ad(watched, url("elsewhere"));
    await t.db.insert(watchlist).values({ productId: watched });

    const dry = await repairAdAttachments(t.db);
    expect(dry).toMatchObject({ mismatched: 5, moved: 2, dropped: 3, emptiedProducts: 0 });
    expect(await productOf(toB)).toBe(a); // dry run changes nothing

    const r = await repairAdAttachments(t.db, { apply: true });
    expect(r).toMatchObject({ mismatched: 5, moved: 2, dropped: 3, emptiedProducts: 1 });
    expect(await productOf(keep)).toBe(a);
    expect(await productOf(toB)).toBe(b);
    expect(await productOf(toA)).toBe(a);
    expect(await productOf(drop)).toBeUndefined();
    const left = (await t.db.select().from(products)).map((p) => p.slug).sort();
    // The product with only wrong ads is gone; the watched one is kept.
    expect(left).toEqual(["a", "b", "led-mask", "watched"]);

    expect(await repairAdAttachments(t.db, { apply: true })).toMatchObject({ mismatched: 0 });
  });

  it("never title-matches Ad Library ads into products", async () => {
    await t.db.insert(sourceItems).values({
      source: "meta_ads",
      provider: "ad_library_web",
      externalId: "loose-ad",
      kind: "ad",
      title: "LED Light Therapy Face Mask",
      firstSeenAt: NOW,
      lastSeenAt: NOW,
    });
    const r = await runMatching(t.db);
    expect(r).toMatchObject({ productsCreated: 0, itemsMatched: 0 });
    expect(await t.db.select().from(products)).toEqual([]);
  });
});

describe("sameProductAdsOnly", () => {
  const item = (landing?: string) =>
    ({ externalId: "x", kind: "ad", metrics: [], raw: { landing_url: landing } }) as never;
  const product = (landingKey: string | null) => ({ productId: "p", query: "q", landingKey });

  it("keeps only ads that link to the product's own page", () => {
    expect(sameProductAdsOnly(item(url("ear-cleaner")), product("handle:ear-cleaner"))).toBe(true);
    expect(sameProductAdsOnly(item(url("other")), product("handle:ear-cleaner"))).toBe(false);
    // Products not discovered from a product page get no ads from keyword searches.
    expect(sameProductAdsOnly(item(url("ear-cleaner")), product(null))).toBe(false);
    // Keyword-level counts describe the search and are kept.
    expect(
      sameProductAdsOnly({ externalId: "k", kind: "trend", metrics: [] } as never, product(null)),
    ).toBe(true);
  });
});

describe("repairProductImages", () => {
  let t: Awaited<ReturnType<typeof createTestDb>>;
  let n = 0;
  beforeEach(async () => {
    t = await createTestDb();
  });
  afterEach(async () => {
    await t.close();
  });

  it("finds products showing a similar product's photo and clears it on apply", async () => {
    const photo = (name: string) => `https://cdn.test/${name}.jpg`;
    const withPhoto = async (
      slug: string,
      imageUrl: string | null,
      mergedInto?: string,
      discovered = true,
    ) => {
      const [p] = await t.db
        .insert(products)
        .values({
          slug,
          title: slug,
          imageUrl,
          imageHash: "ab",
          firstSeenAt: NOW,
          mergedInto,
          landingKey: discovered ? `handle:${slug}` : null,
        })
        .returning();
      return p.id;
    };
    const listing = (productId: string, provider: string, imageUrl: string) =>
      t.db.insert(sourceItems).values({
        source: "shopify",
        provider,
        externalId: `l-${n++}`,
        kind: "store_product",
        productId,
        imageUrl,
        firstSeenAt: NOW,
        lastSeenAt: NOW,
      });
    const good = await withPhoto("good", photo("own"));
    await listing(good, "shopify_catalog_lookup", photo("own"));
    const fixable = await withPhoto("fixable", photo("similar-1"));
    await listing(fixable, "shopify_catalog", photo("similar-1"));
    await listing(fixable, "shopify_catalog_lookup", photo("own-2"));
    const noOwn = await withPhoto("no-own", photo("similar-2"));
    await listing(noOwn, "shopify_catalog", photo("similar-2"));
    await withPhoto("merged", photo("similar-1"), fixable);
    await withPhoto("no-photo", null);
    // Created by matching from a search result: that photo is its own.
    const matched = await withPhoto("matched", photo("seed"), undefined, false);
    await listing(matched, "shopify_catalog", photo("seed"));
    // Sample products are left alone.
    const sample = await withPhoto("sample", photo("similar-3"));
    await listing(sample, "shopify_catalog", photo("similar-3"));
    await listing(sample, "fixture", photo("x"));

    const dry = await repairProductImages(t.db);
    expect(dry).toEqual({
      wrongImages: 2,
      withOwnListingPhoto: 1,
      mergedIntoAffected: 1,
      reset: 0,
    });
    expect((await t.db.select().from(products).where(eq(products.id, noOwn)))[0].imageUrl).toBe(
      photo("similar-2"),
    );

    expect(await repairProductImages(t.db, { apply: true })).toMatchObject({ reset: 2 });
    const after = new Map((await t.db.select().from(products)).map((p) => [p.slug, p]));
    expect(after.get("fixable")).toMatchObject({ imageUrl: null, imageHash: null });
    expect(after.get("no-own")).toMatchObject({ imageUrl: null, imageHash: null });
    expect(after.get("good")).toMatchObject({ imageUrl: photo("own"), imageHash: "ab" });
    expect(after.get("matched")).toMatchObject({ imageUrl: photo("seed"), imageHash: "ab" });
    expect(after.get("sample")).toMatchObject({ imageUrl: photo("similar-3") });
    expect(await repairProductImages(t.db)).toMatchObject({ wrongImages: 0 });
  });
});

describe("repairStoreListings", () => {
  let t: Awaited<ReturnType<typeof createTestDb>>;
  let n = 0;
  beforeEach(async () => {
    t = await createTestDb();
  });
  afterEach(async () => {
    await t.close();
  });

  const OLD = new Date("2026-09-01T00:00:00Z");
  async function product(slug: string) {
    const [p] = await t.db
      .insert(products)
      .values({ slug, title: slug, landingKey: `handle:${slug}`, firstSeenAt: NOW })
      .returning();
    return p.id;
  }
  const item = (
    productId: string | null,
    provider: string,
    kind: "ad" | "store_product",
    page: string,
    seenAt = NOW,
  ) =>
    t.db.insert(sourceItems).values({
      source: kind === "ad" ? "meta_ads" : "shopify",
      provider,
      externalId: `i-${n++}`,
      kind,
      productId,
      url: kind === "ad" ? null : page,
      raw: kind === "ad" ? { landing_url: page } : {},
      firstSeenAt: seenAt,
      lastSeenAt: seenAt,
    });
  const attempt = (productId: string) =>
    t.db.insert(collectionAttempts).values({
      provider: "shopify_catalog_lookup",
      productId,
      attemptedAt: NOW,
      outcome: "found",
    });
  const page = (store: string, handle: string, prefix = "") =>
    `https://${store}.example${prefix}/products/${handle}`;

  it("re-enables the lookup for products whose own listing became a search row", async () => {
    // Own listing overwritten: the page survives only as a search row (attached elsewhere).
    const lost = await product("lost");
    const other = await product("other");
    await item(lost, "ad_library_web", "ad", page("a", "lost", "/collections/x"));
    await item(other, "shopify_catalog", "store_product", page("a", "lost") + "?variant=1");
    await attempt(lost);
    // One page lost, another still fresh: counted, but only due once that row ages out.
    const partial = await product("partial");
    await item(partial, "ad_library_web", "ad", page("b", "one"));
    await item(partial, "ad_library_web", "ad", page("b", "two"));
    await item(partial, "shopify_catalog", "store_product", page("b", "one"));
    await item(partial, "shopify_catalog_lookup", "store_product", page("b", "two"));
    await attempt(partial);
    // Own listing intact next to a search row for the same page: fine.
    const intact = await product("intact");
    await item(intact, "ad_library_web", "ad", page("c", "intact"));
    await item(intact, "shopify_catalog", "store_product", page("c", "intact"));
    await item(intact, "shopify_catalog_lookup", "store_product", page("c", "intact"), OLD);
    await attempt(intact);
    // Same handle on a different store is a different page.
    const elsewhere = await product("elsewhere");
    await item(elsewhere, "ad_library_web", "ad", page("d", "elsewhere"));
    await item(null, "shopify_catalog", "store_product", page("e", "elsewhere"));
    // Sample products are left alone.
    const sample = await product("sample");
    await item(sample, "ad_library_web", "ad", page("f", "sample"));
    await item(sample, "shopify_catalog", "store_product", page("f", "sample"));
    await item(sample, "fixture", "store_product", page("f", "x"));
    await attempt(sample);

    expect(await repairStoreListings(t.db, { now: NOW })).toEqual({
      affected: 2,
      withoutOwnListing: 1,
      stillFresh: 1,
      attemptsCleared: 0,
    });
    expect(await t.db.select().from(collectionAttempts)).toHaveLength(4);

    expect(await repairStoreListings(t.db, { apply: true, now: NOW })).toMatchObject({
      attemptsCleared: 2,
    });
    const left = (await t.db.select().from(collectionAttempts)).map((a) => a.productId).sort();
    expect(left).toEqual([intact, sample].sort());
    expect(await t.db.select().from(sourceItems)).toHaveLength(14);
  });
});
