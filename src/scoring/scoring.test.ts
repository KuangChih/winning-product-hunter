// @vitest-environment node
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { productScores, products } from "@/db/schema";
import { getDictionary } from "@/i18n/dictionaries";
import { fill } from "@/i18n/format";
import { createTestDb } from "@/db/testing/pglite";
import { fixtureAdapters } from "@/ingestion/fixtures";
import { runIngestion } from "@/ingestion/run";
import { runMatching } from "@/matching/run";
import { extractFeatures, type ItemInput } from "./features";
import { runScoring } from "./run";
import { scoreProducts } from "./score";
import type { ProductFeatures } from "./features";
import { percentileRanks, robustZ, theilSenSlope } from "./stats";

const NOW = new Date("2026-10-09T00:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

describe("stats", () => {
  it("robustZ ignores a past spike and handles a flat baseline", () => {
    // Median 3, MAD 1 × 1.4826; the 50 spike barely moves the baseline.
    expect(robustZ(10, [1, 2, 3, 4, 50])).toBeCloseTo((10 - 3) / 1.4826, 5);
    expect(robustZ(5, [2, 2, 2, 2])).toBe(3);
  });

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
    currency: null,
    countries: ["US"],
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

  it("adds reused creatives to scaling and measures reach across priority markets", () => {
    const variants = (n: number) => [{ metric: "creative_variants", value: n, observedAt: NOW }];
    const f = extractFeatures(
      [
        ad(60, { countries: ["US"], snapshots: variants(5) }),
        ad(60, { countries: ["GB"] }),
        ad(60, { countries: ["DE"], endedAt: daysAgo(1) }),
      ],
      NOW,
      NOW,
    );
    expect(f.newAdActivity14d).toBe(2); // (5 - 1) duplicated creatives × 0.5
    // Active ads in US and GB: 2 of the 5 priority markets; the stopped DE ad does not count.
    expect(f.marketReach).toBeCloseTo(0.4);
  });

  it("measures ad momentum from daily ad observations once there is enough history", () => {
    const seenOn = (days: number[]) =>
      days.map((d) => ({ metric: "creative_variants", value: 1, observedAt: daysAgo(d) }));
    // Two ads seen on each of the last 6 days; three more ads appear only today.
    const steady = [
      ad(60, { snapshots: seenOn([5, 4, 3, 2, 1, 0]) }),
      ad(60, { snapshots: seenOn([5, 4, 3, 2, 1, 0]) }),
    ];
    const newToday = [0, 0, 0].map(() => ad(1, { snapshots: seenOn([0]) }));

    const f = extractFeatures([...steady, ...newToday], NOW, NOW);
    expect(f.adHistoryDays).toBe(6);
    // Baseline 2/day (flat → scale max(1, 0.2) = 1), today 5 → z = 3.
    expect(f.adMomentum).toBe(3);

    const short = extractFeatures([ad(60, { snapshots: seenOn([2, 1, 0]) })], NOW, NOW);
    expect(short.adMomentum).toBeNull();
    expect(short.adHistoryDays).toBe(3);
  });

  it("prices the product from the advertiser's own listings, counting similar stores apart", () => {
    const store = (
      seller: string,
      cents: number,
      currency: string,
      provider = "shopify_catalog_lookup",
    ): ItemInput => ({
      source: "shopify",
      provider,
      kind: "store_product",
      advertiserId: seller,
      format: null,
      startedAt: null,
      endedAt: null,
      priceCents: cents,
      currency,
      countries: ["GB"],
      snapshots: [],
    });
    const fx = { date: "2026-10-09", perEur: { EUR: 1, USD: 1.2, GBP: 0.8 } };
    const f = extractFeatures(
      [
        store("a.com", 2000, "USD"),
        store("b.com", 2000, "GBP"),
        store("a.com", 4000, "USD"),
        // Similar products from a catalog search: competition, never this product's price.
        store("c.com", 99900, "USD", "shopify_catalog"),
      ],
      NOW,
      NOW,
      fx,
    );
    expect(f.sellingStores).toBe(3);
    // 2000 GBP → 3000 USD; median of [2000, 3000, 4000].
    expect(f.retailUsdCents).toBe(3000);
    expect(f.longevity).toBeNull();
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
    adMomentum: null,
    adHistoryDays: 0,
    marketReach: 0.4,
    sellingStores: null,
    retailUsdCents: null,
    ageDays: 30,
    sources: ["cj", "google_trends", "meta_ads"],
  };

  it("excludes missing sub-scores instead of counting them as zero", () => {
    const [withGap] = scoreProducts([{ ...base, trendSlope: null }]);
    expect(withGap.breakdown.subScores.demandTrend.value).toBeNull();
    expect(withGap.score).toBeGreaterThan(0);
    expect(withGap.confidence).toBeLessThan(scoreProducts([base])[0].confidence);
  });

  it("scores gross margin from store retail price and supplier cost", () => {
    const [s] = scoreProducts([{ ...base, retailUsdCents: 2000, supplierPriceCents: 500 }]);
    // (20 − 5) / 20 = 75% margin ≥ 60% → full score.
    expect(s.breakdown.subScores.margin).toMatchObject({ value: 1, raw: 0.75 });

    const [half] = scoreProducts([{ ...base, retailUsdCents: 1000, supplierPriceCents: 700 }]);
    expect(half.breakdown.subScores.margin.value).toBeCloseTo(0.5);

    const [none] = scoreProducts([{ ...base, retailUsdCents: null }]);
    expect(none.breakdown.subScores.margin.value).toBeNull();
  });

  it("counts selling stores toward saturation only when known", () => {
    const [a, b] = scoreProducts([
      { ...base, sellingStores: 2 },
      { ...base, sellingStores: 40 },
    ]);
    expect(b.breakdown.saturation.penalty).toBeGreaterThan(a.breakdown.saturation.penalty);
  });

  it("caps single-source products at 70", () => {
    const [s] = scoreProducts([
      { ...base, longevity: 1, sources: ["meta_ads"], activeAdvertisers: 0, ageDays: 0 },
    ]);
    expect(s.score).toBeLessThanOrEqual(70);
    expect(s.confidenceLabel).toBe("low");
  });

  it("stores a translatable explanation that matches the English sentence", () => {
    const en = getDictionary("en").breakdown.explain;
    const variants = scoreProducts([
      base,
      { ...base, retailUsdCents: 2000 },
      { ...base, supplierPriceCents: null },
      { ...base, adMomentum: 1.5, adHistoryDays: 9 },
    ]);
    for (const p of variants) {
      for (const sub of Object.values(p.breakdown.subScores)) {
        expect(sub.explain).toBeDefined();
        expect(fill(en[sub.explain!.key], sub.explain!.params ?? {})).toBe(sub.basis);
      }
    }
    expect(variants[0].breakdown.subScores.momentum.explain).toEqual({
      key: "momentumNeedsHistory",
      params: { need: 5, have: 0 },
    });
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
