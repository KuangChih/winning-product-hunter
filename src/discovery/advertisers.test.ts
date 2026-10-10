// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { products, productScores, sourceItems } from "@/db/schema";
import { createTestDb } from "@/db/testing/pglite";
import { advertiserTargets, pickAdvertisers, rankAdvertisers } from "./advertisers";

const NOW = new Date("2026-10-10T00:00:00Z");

describe("advertiser following", () => {
  let t: Awaited<ReturnType<typeof createTestDb>>;
  let n = 0;

  beforeEach(async () => {
    t = await createTestDb();
  });
  afterEach(async () => {
    await t.close();
  });

  async function product(slug: string, score: number | null, mergedInto?: string) {
    const [p] = await t.db
      .insert(products)
      .values({ slug, title: slug, firstSeenAt: NOW, mergedInto })
      .returning();
    if (score !== null) {
      await t.db.insert(productScores).values({
        productId: p.id,
        scoringVersion: "v1.1",
        score,
        confidence: 0.3,
        breakdown: {},
        computedAt: NOW,
      });
    }
    return p.id;
  }

  async function ad(
    productId: string,
    pageId: string,
    countries: string[],
    landing = "https://store.example/products/thing",
    provider = "ad_library_web",
  ) {
    await t.db.insert(sourceItems).values({
      source: "meta_ads",
      provider,
      externalId: `ad-${n++}`,
      kind: "ad",
      productId,
      advertiserId: pageId,
      advertiserName: `Store ${pageId}`,
      countries,
      firstSeenAt: NOW,
      lastSeenAt: NOW,
      raw: { landing_url: landing },
    });
  }

  it("ranks e-commerce advertisers by their best product, in their main priority market", async () => {
    const hot = await product("hot", 70);
    const mid = await product("mid", 50);
    const unscored = await product("unscored", null);
    await ad(hot, "1", ["AU"]);
    await ad(hot, "1", ["AU"]);
    await ad(mid, "1", ["US"]);
    await ad(mid, "2", ["GB", "DE"]);
    await ad(unscored, "3", ["DE"]);
    // Not a store product page (brand site / lead form): not worth following.
    await ad(mid, "4", ["US"], "https://brand.example/about");
    // Sample data never drives real discovery.
    const sampleOnly = await product("sample-only", 99);
    await ad(sampleOnly, "5", ["US"], undefined, "fixture");

    const ranked = await rankAdvertisers(t.db);
    expect(ranked.map((a) => [a.pageId, a.country, a.bestScore, a.productPageAds])).toEqual([
      ["1", "AU", 70, 3],
      ["2", "GB", 50, 1],
      // Only a non-priority market seen: falls back to the US.
      ["3", "US", null, 1],
    ]);
    expect(advertiserTargets(ranked.slice(0, 2))).toEqual(["1@AU", "2@GB"]);
  });

  it("ignores products with any sample evidence, even when real ads are attached", async () => {
    const sample = await product("led-mask", 90);
    await ad(sample, "7", ["US"]);
    await ad(sample, "8", ["US"], "https://x.example/products/led-mask", "fixture");
    const real = await product("real", 40);
    await ad(real, "6", ["US"]);
    expect((await rankAdvertisers(t.db)).map((a) => a.pageId)).toEqual(["6"]);
  });

  it("ignores ads attached to products merged into another one", async () => {
    const survivor = await product("survivor", 60);
    const merged = await product("merged", 90, survivor);
    await ad(merged, "9", ["US"]);
    expect(await rankAdvertisers(t.db)).toEqual([]);
  });

  it("rotates daily through the best advertisers, covering the pool over a few days", async () => {
    for (let i = 0; i < 6; i++) {
      const p = await product(`p${i}`, 90 - i);
      await ad(p, String(100 + i), ["US"]);
    }
    const day = (d: number) => new Date(NOW.getTime() + d * 86_400_000);
    const pick = async (d: number) =>
      (await pickAdvertisers(t.db, 2, { day: day(d), poolFactor: 2 })).map((a) => a.pageId);

    // Pool = top 4 (2 × poolFactor); two per day, so the pool is covered every 2 days.
    const seen = new Set([...(await pick(0)), ...(await pick(1))]);
    expect(seen).toEqual(new Set(["100", "101", "102", "103"]));
    expect(await pick(0)).toEqual(await pick(2));
  });
});
