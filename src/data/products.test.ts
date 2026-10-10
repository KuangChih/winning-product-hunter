// @vitest-environment node
import { desc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { productScores, products, sourceItems } from "@/db/schema";
import { createTestDb } from "@/db/testing/pglite";
import { fixtureAdapters } from "@/ingestion/fixtures";
import { runIngestion } from "@/ingestion/run";
import { runMatching } from "@/matching/run";
import { runScoring } from "@/scoring/run";
import { getRankedProducts } from "./products";

const NOW = new Date("2026-10-09T00:00:00Z");

describe("getRankedProducts", () => {
  let t: Awaited<ReturnType<typeof createTestDb>>;

  beforeEach(async () => {
    t = await createTestDb();
  });

  afterEach(async () => {
    await t.close();
  });

  it("returns an empty list before anything is scored", async () => {
    expect(await getRankedProducts(t.db)).toEqual([]);
  });

  it("ranks by the latest score and flags fixture-only evidence as sample data", async () => {
    for (const make of Object.values(fixtureAdapters)) {
      await runIngestion(t.db, make(), { queries: [], limit: 500 }, () => NOW);
    }
    await runMatching(t.db);
    await runScoring(t.db, new Date("2026-10-01T00:00:00Z"));
    await runScoring(t.db, NOW);

    const ranked = await getRankedProducts(t.db, { limit: 3, includeSample: true });

    expect(ranked).toHaveLength(3);
    expect(ranked.map((r) => r.score)).toEqual(
      [...ranked.map((r) => r.score)].sort((a, b) => b - a),
    );
    expect(ranked.every((r) => r.computedAt.getTime() === NOW.getTime())).toBe(true);
    expect(ranked[0]).toMatchObject({
      title: "Silicone Dog Paw Cleaner Cup",
      isSample: true,
      sources: ["cj", "google_trends", "meta_ads"],
      // Meta fixtures are EU ads, Trends fixtures are US; CJ listings have no country.
      markets: ["US", "DE", "FR", "SE", "BE", "ES"],
    });
    expect(ranked[0].breakdown.subScores.longevity.weight).toBe(0.15);
  });

  it("hides products with sample evidence unless asked, filtering before the limit", async () => {
    for (const make of Object.values(fixtureAdapters)) {
      await runIngestion(t.db, make(), { queries: [], limit: 500 }, () => NOW);
    }
    await runMatching(t.db);
    // A real product with a real ad, ranked below the sample ones.
    const [real] = await t.db
      .insert(products)
      .values({ slug: "real-product", title: "Real Product", firstSeenAt: NOW })
      .returning();
    await runIngestion(
      t.db,
      {
        source: "meta_ads",
        provider: "ad_library_web",
        async *fetch() {
          yield {
            externalId: "real-ad",
            kind: "ad" as const,
            countries: ["US"],
            startedAt: new Date("2026-10-08T00:00:00Z"),
            productId: real.id,
            metrics: [],
            raw: {},
          };
        },
      },
      { queries: [], limit: 10 },
    );
    await runScoring(t.db, NOW);

    const realOnly = await getRankedProducts(t.db, { limit: 1 });
    expect(realOnly.map((p) => p.title)).toEqual(["Real Product"]);
    expect(realOnly[0].isSample).toBe(false);
    expect(await getRankedProducts(t.db, { includeSample: true })).toHaveLength(6);
  });

  it("prices each product from the advertiser's own store, never from similar products", async () => {
    const [priced, unpriced] = await t.db
      .insert(products)
      .values([
        { slug: "priced", title: "Priced", firstSeenAt: NOW },
        { slug: "unpriced", title: "Unpriced", firstSeenAt: NOW },
      ])
      .returning();
    const offer = (id: string, priceCents: number, provider = "shopify_catalog_lookup") => ({
      source: "shopify" as const,
      provider,
      externalId: id,
      kind: "store_product" as const,
      productId: priced.id,
      countries: ["US"],
      priceCents,
      currency: "USD",
      firstSeenAt: NOW,
      lastSeenAt: NOW,
    });
    await t.db
      .insert(sourceItems)
      .values([
        offer("a", 2000),
        offer("b", 3000),
        offer("c", 2600),
        offer("similar", 99900, "shopify_catalog"),
      ]);
    const score = (productId: string, value: number) => ({
      productId,
      scoringVersion: "v1.1",
      score: value,
      confidence: 0.5,
      breakdown: { saturation: { ageDays: 1, penalty: 0, activeAdvertisers: 0, value: 0 } },
      computedAt: NOW,
    });
    await t.db.insert(productScores).values([score(priced.id, 60), score(unpriced.id, 50)]);

    const ranked = await getRankedProducts(t.db);
    expect(ranked.map((p) => [p.title, p.retailUsdCents])).toEqual([
      ["Priced", 2600],
      ["Unpriced", null],
    ]);
    expect((await getRankedProducts(t.db, { minPrice: 25 })).map((p) => p.title)).toEqual([
      "Priced",
    ]);
  });

  it("ranks exactly like the latest score per product over the whole history", async () => {
    for (const make of Object.values(fixtureAdapters)) {
      await runIngestion(t.db, make(), { queries: [], limit: 500 }, () => NOW);
    }
    await runMatching(t.db);
    await runScoring(t.db, new Date("2026-10-01T00:00:00Z"));
    // New evidence between batches changes some scores, so the two batches differ.
    const [late] = await t.db
      .insert(products)
      .values({ slug: "late", title: "Late Product", firstSeenAt: NOW })
      .returning();
    await t.db.insert(sourceItems).values({
      source: "meta_ads",
      provider: "fixture",
      externalId: "late-ad",
      kind: "ad",
      productId: late.id,
      countries: ["US"],
      startedAt: new Date("2026-10-05T00:00:00Z"),
      firstSeenAt: NOW,
      lastSeenAt: NOW,
    });
    await runScoring(t.db, new Date("2026-10-05T00:00:00Z"));
    await runScoring(t.db, NOW);

    // The previous implementation: DISTINCT ON over every past score, highest first.
    const reference = (
      await t.db
        .selectDistinctOn([productScores.productId], {
          id: productScores.productId,
          score: productScores.score,
        })
        .from(productScores)
        .orderBy(productScores.productId, desc(productScores.computedAt))
    ).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

    const ranked = await getRankedProducts(t.db, { includeSample: true });
    expect(ranked.map((p) => [p.id, p.score])).toEqual(reference.map((r) => [r.id, r.score]));
    expect(ranked.length).toBeGreaterThan(3);
    expect(ranked.find((p) => p.id === late.id)?.firstSeenAt).toEqual(NOW);
  });

  it("leaves out stale scores of products merged away after the last batch", async () => {
    const [kept, merged] = await t.db
      .insert(products)
      .values([
        { slug: "kept", title: "Kept", firstSeenAt: NOW },
        { slug: "merged", title: "Merged", firstSeenAt: NOW },
      ])
      .returning();
    const score = (productId: string, value: number, computedAt: Date) => ({
      productId,
      scoringVersion: "v1.1",
      score: value,
      confidence: 0.5,
      breakdown: { saturation: { ageDays: 1, penalty: 0, activeAdvertisers: 0, value: 0 } },
      computedAt,
    });
    const before = new Date("2026-10-01T00:00:00Z");
    await t.db
      .insert(productScores)
      .values([score(kept.id, 40, before), score(merged.id, 90, before), score(kept.id, 50, NOW)]);
    await t.db.update(products).set({ mergedInto: kept.id }).where(eq(products.id, merged.id));

    expect((await getRankedProducts(t.db)).map((p) => [p.title, p.score])).toEqual([["Kept", 50]]);
  });

  it("applies the limit after filters and sort", async () => {
    const rows = await t.db
      .insert(products)
      .values(["a", "b", "c"].map((slug) => ({ slug, title: `Product ${slug}`, firstSeenAt: NOW })))
      .returning();
    await t.db.insert(productScores).values(
      rows.map((r, i) => ({
        productId: r.id,
        scoringVersion: "v1.1",
        score: 10 + i * 10,
        confidence: 0.5,
        breakdown: { saturation: { ageDays: 1, penalty: 0, activeAdvertisers: 0, value: 0 } },
        computedAt: NOW,
      })),
    );
    expect((await getRankedProducts(t.db)).map((p) => p.slug)).toEqual(["c", "b", "a"]);
    expect((await getRankedProducts(t.db, { limit: 2 })).map((p) => p.slug)).toEqual(["c", "b"]);
    expect(
      (await getRankedProducts(t.db, { q: "product a", limit: 2 })).map((p) => p.slug),
    ).toEqual(["a"]);
  });
});
