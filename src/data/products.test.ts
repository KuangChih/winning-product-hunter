// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { products } from "@/db/schema";
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
});
