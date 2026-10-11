// @vitest-environment node
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getLatestFxRates } from "@/data/fx";
import { productScores, products, signalSnapshots, sourceItems } from "@/db/schema";
import { getDictionary } from "@/i18n/dictionaries";
import { fill } from "@/i18n/format";
import { createTestDb } from "@/db/testing/pglite";
import { fixtureAdapters } from "@/ingestion/fixtures";
import { runIngestion } from "@/ingestion/run";
import { runMatching } from "@/matching/run";
import { adDaysOf, dedupeAds, extractFeatures, type ItemInput } from "./features";
import { runScoring } from "./run";
import { SCORING_VERSION, scoreProducts } from "./score";
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
    expect(f.retailBasis).toBe("own_listing");
    expect(f.samePhotoStores).toBeNull();
    expect(f.longevity).toBeNull();
  });

  it("prices a product without its own listing from stores selling the same photo (ADR-016)", () => {
    const found = (seller: string, cents: number, samePhoto: boolean | null): ItemInput => ({
      source: "shopify",
      provider: "shopify_catalog",
      kind: "store_product",
      advertiserId: seller,
      format: null,
      startedAt: null,
      endedAt: null,
      priceCents: cents,
      currency: "USD",
      countries: ["US"],
      snapshots: [],
      samePhoto,
    });
    const f = extractFeatures(
      [
        found("a.com", 1800, true),
        found("b.com", 2400, true),
        found("c.com", 3000, true),
        found("d.com", 99900, false),
        found("e.com", 99900, null),
      ],
      NOW,
      NOW,
    );
    expect(f).toMatchObject({
      retailUsdCents: 2400,
      retailBasis: "same_photo",
      retailStores: 3,
      samePhotoStores: 3,
      // Saturation still counts every store selling similar products.
      sellingStores: 5,
    });
  });

  it("counts an ad stored by both the website and the official API once (ADR-015)", () => {
    const web = ad(20, { provider: "ad_library_web", adKey: "meta_ads:1", countries: ["US"] });
    const api = ad(20, {
      provider: "ad_library_api",
      adKey: "meta_ads:1",
      format: null,
      countries: ["GB"],
      snapshots: [{ metric: "eu_total_reach", value: 900, observedAt: NOW }],
    });
    const other = ad(2, { provider: "ad_library_api", adKey: "meta_ads:2", advertiserId: "a2" });
    const once = extractFeatures([web, other], NOW, NOW);
    const both = extractFeatures([api, web, other], NOW, NOW);
    expect(both.activeAds).toBe(2);
    expect(both.newAdActivity14d).toBe(once.newAdActivity14d);
    expect(both.longevity).toBe(once.longevity);
    // The API record adds the UK to the markets the ad reached.
    expect(both.marketReach).toBeGreaterThan(once.marketReach!);
    expect(dedupeAds([api, web])).toEqual([
      { ...web, countries: ["US", "GB"], snapshots: api.snapshots },
    ]);
    // Without an ad key (e.g. other sources) nothing is merged.
    expect(dedupeAds([ad(1), ad(1)])).toHaveLength(2);
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
    marketplaceBasis: "units_90d",
    supplierPriceCents: 500,
    freightUsdCents: 300,
    adMomentum: null,
    adHistoryDays: 0,
    marketReach: 0.4,
    sellingStores: null,
    retailUsdCents: null,
    retailBasis: null,
    retailStores: 0,
    samePhotoStores: null,
    ageDays: 30,
    sources: ["cj", "google_trends", "meta_ads"],
  };

  it("excludes missing sub-scores instead of counting them as zero", () => {
    const [withGap] = scoreProducts([{ ...base, trendSlope: null }]);
    expect(withGap.breakdown.subScores.demandTrend.value).toBeNull();
    expect(withGap.score).toBeGreaterThan(0);
    expect(withGap.confidence).toBeLessThan(scoreProducts([base])[0].confidence);
  });

  it("scores the landed margin: retail − CJ variant − shipping (ADR-017)", () => {
    const [s] = scoreProducts([
      { ...base, retailUsdCents: 2000, supplierPriceCents: 500, freightUsdCents: 300 },
    ]);
    // (20 − 5 − 3) / 20 = 60% ≥ 40% → full score.
    expect(s.breakdown.subScores.margin).toMatchObject({ value: 1, raw: 0.6 });

    const [half] = scoreProducts([
      { ...base, retailUsdCents: 1000, supplierPriceCents: 500, freightUsdCents: 300 },
    ]);
    expect(half.breakdown.subScores.margin.value).toBeCloseTo(0.5);

    // Shipping above what the price leaves: a negative margin scores 0, never hidden.
    const [loss] = scoreProducts([
      { ...base, retailUsdCents: 2000, supplierPriceCents: 995, freightUsdCents: 2993 },
    ]);
    expect(loss.breakdown.subScores.margin).toMatchObject({ value: 0, raw: -0.994 });

    const [none] = scoreProducts([{ ...base, retailUsdCents: null }]);
    expect(none.breakdown.subScores.margin.value).toBeNull();
    const [noShipping] = scoreProducts([{ ...base, retailUsdCents: 2000, freightUsdCents: null }]);
    expect(noShipping.breakdown.subScores.margin).toMatchObject({
      value: null,
      explain: { key: "marginNeedsShipping" },
    });
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

  it("caps a product measured by one signal only (e.g. CJ orders) at 50", () => {
    const cjOnly: ProductFeatures = {
      ...base,
      longevity: null,
      activeAds: 0,
      activeAdvertisers: 0,
      newAdActivity14d: null,
      trendSlope: null,
      marketReach: null,
      marketplaceOrders: 5000,
      marketplaceBasis: "cj_orders",
      ageDays: 0,
      sources: ["cj"],
    };
    const [top, low] = scoreProducts([cjOnly, { ...cjOnly, marketplaceOrders: 10 }]);
    expect(top.score).toBe(50);
    expect(top.breakdown).toMatchObject({
      capped: true,
      capLimit: 50,
      capReason: "thin_evidence",
    });
    expect(top.breakdown.subScores.marketplace.explain?.key).toBe("marketplaceCjOrders");
    expect(top.breakdown.subScores.longevity.value).toBeNull();
    expect(top.confidenceLabel).toBe("low");
    expect(low.breakdown.capped).toBe(false);

    // A margin (cheap to source) is not a second demand signal: still capped (ADR-016).
    const [withMargin] = scoreProducts([
      { ...cjOnly, retailUsdCents: 2500, supplierPriceCents: 300, retailBasis: "same_photo" },
      { ...cjOnly, marketplaceOrders: 10 },
    ]);
    expect(withMargin.breakdown.subScores.margin.value).toBe(1);
    expect(withMargin.score).toBe(50);
    expect(withMargin.breakdown.capReason).toBe("thin_evidence");
  });

  it("stores a translatable explanation that matches the English sentence", () => {
    const en = getDictionary("en").breakdown.explain;
    const variants = scoreProducts([
      base,
      { ...base, retailUsdCents: 2000 },
      { ...base, retailUsdCents: 2000, retailBasis: "same_photo", retailStores: 4 },
      { ...base, retailUsdCents: 2000, freightUsdCents: null },
      { ...base, supplierPriceCents: null },
      { ...base, adMomentum: 1.5, adHistoryDays: 9 },
      { ...base, marketplaceBasis: "cj_orders" },
    ]);
    for (const p of variants) {
      for (const sub of Object.values(p.breakdown.subScores)) {
        expect(sub.explain).toBeDefined();
        expect(fill(en[sub.explain!.key], sub.explain!.params ?? {})).toBe(sub.basis);
      }
    }
    expect(variants[2].breakdown.subScores.margin.explain).toEqual({
      key: "landedMarginSamePhoto",
      params: { retail: "20.00", supplier: "5.00", shipping: "3.00", stores: 4 },
    });
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

  /** The previous runScoring: every item column and every snapshot, filtered per product. */
  async function legacyScores(now: Date) {
    const items = await t.db.select().from(sourceItems);
    const attached = items.filter((i) => i.productId);
    const snapshots = await t.db.select().from(signalSnapshots);
    const fx = await getLatestFxRates(t.db);
    const productRows = (await t.db.select().from(products)).filter((p) =>
      attached.some((i) => i.productId === p.id),
    );
    const features = productRows.map((p) =>
      extractFeatures(
        attached
          .filter((i) => i.productId === p.id)
          .map((i) => ({
            ...i,
            snapshots: snapshots
              .filter((s) => s.sourceItemId === i.id)
              .map((s) => ({ metric: s.metric, value: s.value, observedAt: s.observedAt })),
          })),
        p.firstSeenAt,
        now,
        fx,
      ),
    );
    const scores = scoreProducts(features);
    return new Map(productRows.map((p, i) => [p.id, scores[i]]));
  }

  it("gives exactly the scores of the previous implementation (SQL-reduced snapshots)", async () => {
    // Long daily ad history (more days than the momentum window, with gaps and several
    // metrics per day), changing creative variants, and a trend series.
    const [product] = await t.db
      .insert(products)
      .values({ slug: "history", title: "History", firstSeenAt: daysAgo(40) })
      .returning();
    const ads = await t.db
      .insert(sourceItems)
      .values(
        [0, 1, 2].map((k) => ({
          source: "meta_ads" as const,
          provider: "ad_library_web",
          externalId: `hist-${k}`,
          kind: "ad" as const,
          productId: product.id,
          advertiserId: `adv-${k}`,
          format: "image",
          startedAt: daysAgo(40 - k),
          countries: ["US", "CA"],
          firstSeenAt: daysAgo(30),
          lastSeenAt: NOW,
        })),
      )
      .returning();
    const [trend] = await t.db
      .insert(sourceItems)
      .values({
        source: "google_trends",
        provider: "test",
        externalId: "hist-trend",
        kind: "trend",
        productId: product.id,
        firstSeenAt: daysAgo(30),
        lastSeenAt: NOW,
      })
      .returning();
    const rows: Array<typeof signalSnapshots.$inferInsert> = [];
    for (let d = 30; d >= 0; d--) {
      if (d % 7 === 3) continue;
      ads.forEach((ad, k) => {
        if ((d + k) % 4 === 0) return;
        const at = new Date(daysAgo(d).getTime() + k * 3_600_000);
        rows.push({
          sourceItemId: ad.id,
          metric: "creative_variants",
          value: 1 + ((d + k) % 3),
          observedAt: at,
        });
        rows.push({ sourceItemId: ad.id, metric: "eu_total_reach", value: d * 10, observedAt: at });
      });
      rows.push({
        sourceItemId: trend.id,
        metric: "search_interest",
        value: 40 + d,
        observedAt: daysAgo(d),
      });
    }
    await t.db.insert(signalSnapshots).values(rows);

    const expected = await legacyScores(NOW);
    await runScoring(t.db, NOW);
    const actual = await t.db.select().from(productScores);

    expect(actual).toHaveLength(expected.size);
    for (const row of actual) {
      const want = expected.get(row.productId)!;
      expect(row.scoringVersion).toBe(SCORING_VERSION);
      expect({ score: row.score, confidence: row.confidence, breakdown: row.breakdown }).toEqual({
        score: want.score,
        confidence: want.confidence,
        breakdown: JSON.parse(JSON.stringify(want.breakdown)),
      });
    }
    // The history product really exercises momentum beyond the window.
    const history = actual.find((r) => r.productId === product.id)!;
    expect(JSON.stringify(history.breakdown)).toContain('"explain":{"key":"momentum"}');
    expect(adDaysOf([]).total).toBe(0);
  });
});
