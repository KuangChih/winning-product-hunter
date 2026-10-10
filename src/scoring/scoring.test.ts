// @vitest-environment node
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { productScores, products } from "@/db/schema";
import { createTestDb } from "@/db/testing/pglite";
import { fixtureAdapters } from "@/ingestion/fixtures";
import { runIngestion } from "@/ingestion/run";
import { runMatching } from "@/matching/run";
import { extractFeatures, type ItemInput } from "./features";
import { runScoring } from "./run";
import { scoreProducts } from "./score";
import type { ProductFeatures } from "./features";
import { percentileRanks, theilSenSlope } from "./stats";

const NOW = new Date("2026-10-09T00:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

describe("stats", () => {
  it("theilSenSlope ignores a single outlier", () => {
    const pts = [0, 1, 2, 3, 4, 5].map((x) => ({ x, y: 2 * x }));
    pts[3].y = 100;
    expect(theilSenSlope(pts)).toBe(2);
  });

  it("percentileRanks shares ranks on ties", () => {
    expect(percentileRanks([10, 20, 20, 30])).toEqual([0, 0.5, 0.5, 1]);
    expect(percentileRanks([7])).toEqual([0.5]);
  });
});

describe("extractFeatures", () => {
  const ad = (startDaysAgo: number, extra: Partial<ItemInput> = {}): ItemInput => ({
    source: "meta_ads",
    kind: "ad",
    advertiserId: "a1",
    format: "video",
    startedAt: daysAgo(startDaysAgo),
    endedAt: null,
    priceCents: null,
    snapshots: [],
    ...extra,
  });

  it("returns null (not zero) for signals without data", () => {
    const f = extractFeatures([], NOW, NOW);
    expect(f).toMatchObject({
      longevity: null,
      newAdActivity14d: null,
      trendSlope: null,
      marketplaceOrders: null,
    });
  });

  it("rewards long-running ads and discounts stopped ones", () => {
    const running = extractFeatures([ad(90)], NOW, NOW).longevity!;
    const stopped = extractFeatures([ad(90, { endedAt: daysAgo(1) })], NOW, NOW).longevity!;
    const fresh = extractFeatures([ad(3)], NOW, NOW).longevity!;
    expect(running).toBeGreaterThan(0.9);
    expect(stopped).toBeLessThan(running / 1.9);
    expect(fresh).toBeLessThan(0.2);
  });

  it("counts new ads and new advertisers in the last 14 days, and dates age from the oldest ad", () => {
    const f = extractFeatures(
      [ad(60), ad(5, { advertiserId: "a2" }), ad(3, { advertiserId: "a1" })],
      NOW,
      NOW,
    );
    expect(f.newAdActivity14d).toBe(3); // 2 new ads + 1 new advertiser (a2)
    expect(f.activeAdvertisers).toBe(2);
    expect(Math.round(f.ageDays)).toBe(60);
  });
});

describe("scoreProducts", () => {
  const base: ProductFeatures = {
    longevity: 0.5,
    activeAds: 3,
    activeAdvertisers: 2,
    newAdActivity14d: 2,
    trendSlope: 0,
    marketplaceOrders: 100,
    supplierPriceCents: 500,
    ageDays: 30,
    sources: ["cj", "google_trends", "meta_ads"],
  };

  it("excludes missing sub-scores instead of counting them as zero", () => {
    const [withGap] = scoreProducts([{ ...base, trendSlope: null }]);
    expect(withGap.breakdown.subScores.demandTrend.value).toBeNull();
    expect(withGap.score).toBeGreaterThan(0);
    expect(withGap.confidence).toBeLessThan(scoreProducts([base])[0].confidence);
  });

  it("caps single-source products at 70", () => {
    const [s] = scoreProducts([
      { ...base, longevity: 1, sources: ["meta_ads"], activeAdvertisers: 0, ageDays: 0 },
    ]);
    expect(s.score).toBeLessThanOrEqual(70);
    expect(s.confidenceLabel).toBe("low");
  });
});

describe("runScoring on fixture data", () => {
  let t: Awaited<ReturnType<typeof createTestDb>>;

  beforeEach(async () => {
    t = await createTestDb();
    for (const make of Object.values(fixtureAdapters)) {
      await runIngestion(t.db, make(), { queries: [], limit: 500 }, () => NOW);
    }
    await runMatching(t.db);
  });

  afterEach(async () => {
    await t.close();
  });

  it("ranks rising, unsaturated products above declining or saturated ones", async () => {
    expect(await runScoring(t.db, NOW)).toEqual({ productsScored: 5 });

    const rows = await t.db
      .select({ title: products.title, score: productScores.score })
      .from(productScores)
      .innerJoin(products, eq(products.id, productScores.productId));
    const rank = rows.sort((a, b) => b.score - a.score).map((r) => r.title);
    const pos = (needle: string) => rank.findIndex((t) => t.includes(needle));

    // Story check against scripts/generate-fixtures.mjs: the fast-rising newcomer and the
    // steadily rising product should beat the declining and the saturated incumbents.
    expect(pos("Paw Cleaner")).toBeLessThan(pos("Blender"));
    expect(pos("Posture")).toBeLessThan(pos("Blender"));
    expect(pos("Paw Cleaner")).toBeLessThan(pos("LED"));
  });
});
