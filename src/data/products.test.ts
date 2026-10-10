// @vitest-environment node
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

  it("adds each product's US median retail price from the stores selling it", async () => {
    const [priced, unpriced] = await t.db
      .insert(products)
      .values([
        { slug: "priced", title: "Priced", firstSeenAt: NOW },
        { slug: "unpriced", title: "Unpriced", firstSeenAt: NOW },
      ])
      .returning();
    const offer = (id: string, priceCents: number) => ({
      source: "shopify" as const,
      provider: "shopify_catalog",
      externalId: id,
      kind: "store_product" as const,
      productId: priced.id,
      countries: ["US"],
      priceCents,
      currency: "USD",
      firstSeenAt: NOW,
      lastSeenAt: NOW,
    });
    await t.db.insert(sourceItems).values([offer("a", 2000), offer("b", 3000), offer("c", 2600)]);
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
});
