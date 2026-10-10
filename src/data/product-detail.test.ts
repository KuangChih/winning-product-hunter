// @vitest-environment node
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { products, signalSnapshots, sourceItems } from "@/db/schema";
import { createTestDb } from "@/db/testing/pglite";
import { fixtureAdapters } from "@/ingestion/fixtures";
import { runIngestion } from "@/ingestion/run";
import { runMatching } from "@/matching/run";
import { runScoring } from "@/scoring/run";
import { getProductDetail, getProductTitle, type ProductDetail } from "./product-detail";

// The seeded data is all fixtures (sample data), which the website never shows.
const SAMPLE = { includeSample: true };

const NOW = new Date("2026-10-09T00:00:00Z");

describe("getProductDetail", () => {
  let t: Awaited<ReturnType<typeof createTestDb>>;

  beforeEach(async () => {
    t = await createTestDb();
    for (const make of Object.values(fixtureAdapters)) {
      await runIngestion(t.db, make(), { queries: [], limit: 500 }, () => NOW);
    }
    await runMatching(t.db);
    await runScoring(t.db, new Date("2026-10-08T00:00:00Z"));
    await runScoring(t.db, NOW);
  });

  afterEach(async () => {
    await t.close();
  });

  it("returns null for an unknown slug", async () => {
    expect(await getProductDetail(t.db, "nope")).toBeNull();
  });

  it("returns the latest score, score history and evidence grouped by item", async () => {
    const d = (await getProductDetail(
      t.db,
      "silicone-dog-paw-cleaner-cup",
      SAMPLE,
    )) as ProductDetail;

    expect(d).not.toBeNull();
    expect(d!.isSample).toBe(true);
    expect(d!.score?.computedAt.toISOString()).toBe(NOW.toISOString());
    expect(d!.scoreHistory.map((s) => s.computedAt.toISOString())).toEqual([
      "2026-10-08T00:00:00.000Z",
      NOW.toISOString(),
    ]);

    const kinds = d!.evidence.map((e) => e.kind).sort();
    expect(kinds.filter((k) => k === "ad")).toHaveLength(5);
    expect(kinds).toContain("trend");
    expect(kinds).toContain("listing");

    const trend = d!.evidence.find((e) => e.kind === "trend")!;
    expect(trend.series.search_interest).toHaveLength(11);
    // Series are in chronological order.
    const times = trend.series.search_interest.map((p) => p.observedAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));

    const listing = d!.evidence.find((e) => e.kind === "listing")!;
    expect(listing.source).toBe("cj");
    expect(listing.metrics.units_sold_90d).toBe(1300);
    expect(listing.series.units_sold_90d).toBeUndefined();
  });

  it("points a merged duplicate at the surviving product", async () => {
    const [survivor, loser] = await t.db.select().from(products).limit(2);
    await t.db.update(products).set({ mergedInto: survivor.id }).where(eq(products.id, loser.id));

    expect(await getProductDetail(t.db, loser.slug)).toEqual({ redirectTo: survivor.slug });
    expect(await getProductDetail(t.db, survivor.slug, SAMPLE)).toHaveProperty("evidence");
  });

  it("hides sample (fixture) products: no page and no title", async () => {
    // The page turns null into "not found"; the <title> must not leak the name either.
    expect(await getProductDetail(t.db, "silicone-dog-paw-cleaner-cup")).toBeNull();
    expect(await getProductTitle(t.db, "silicone-dog-paw-cleaner-cup")).toBeNull();

    const [real] = await t.db
      .insert(products)
      .values({ slug: "real-product", title: "Real Product", firstSeenAt: NOW })
      .returning();
    expect(await getProductTitle(t.db, real.slug)).toBe("Real Product");
    expect(await getProductDetail(t.db, real.slug)).toMatchObject({
      title: "Real Product",
      isSample: false,
    });
  });

  it("returns the advertiser's page and each ad's landing URL, with snapshots per item", async () => {
    const [p] = await t.db
      .insert(products)
      .values({
        slug: "neck-fan",
        title: "Neck Fan",
        canonicalUrl: "https://shop.example/products/neck-fan",
        firstSeenAt: NOW,
      })
      .returning();
    const items = await t.db
      .insert(sourceItems)
      .values(
        ["1", "2"].map((n) => ({
          source: "meta_ads" as const,
          provider: "ad_library_web",
          externalId: `neck-fan-${n}`,
          kind: "ad" as const,
          productId: p.id,
          url: `https://www.facebook.com/ads/library/?id=${n}`,
          raw: { landing_url: `https://store-${n}.example/products/neck-fan?utm=x` },
          firstSeenAt: NOW,
          lastSeenAt: NOW,
        })),
      )
      .returning();
    // Interleaved in time, so grouping by item must not mix them up.
    await t.db.insert(signalSnapshots).values(
      [0, 1, 2].flatMap((i) =>
        items.map((item, k) => ({
          sourceItemId: item.id,
          metric: "creative_variants",
          value: (k + 1) * 10 + i,
          observedAt: new Date(NOW.getTime() + i * 1000),
        })),
      ),
    );

    const d = (await getProductDetail(t.db, "neck-fan")) as ProductDetail;
    expect(d.canonicalUrl).toBe("https://shop.example/products/neck-fan");
    const byId = new Map(d.evidence.map((e) => [e.id, e]));
    const [a, b] = items.map((i) => byId.get(i.id)!);
    expect(a.landingUrl).toBe("https://store-1.example/products/neck-fan?utm=x");
    expect(b.landingUrl).toBe("https://store-2.example/products/neck-fan?utm=x");
    expect(a.metrics.creative_variants).toBe(12);
    expect(b.metrics.creative_variants).toBe(22);
    expect(a.series.creative_variants.map((s) => s.value)).toEqual([10, 11, 12]);
    expect(b.series.creative_variants.map((s) => s.value)).toEqual([20, 21, 22]);
    // The large raw payload itself is not loaded.
    expect(a).not.toHaveProperty("raw");
  });
});
