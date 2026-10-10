// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { products, sourceItems } from "@/db/schema";
import { createTestDb } from "@/db/testing/pglite";
import { AD_PAGE_SIZE, getAds, parseAdParams } from "./ads";

const NOW = new Date("2026-10-10T00:00:00Z");
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

type ItemInsert = typeof sourceItems.$inferInsert;

describe("getAds", () => {
  let t: Awaited<ReturnType<typeof createTestDb>>;
  let n = 0;
  const ad = (overrides: Partial<ItemInsert>): ItemInsert => ({
    source: "meta_ads",
    provider: "ad_library_web",
    externalId: `ad-${n++}`,
    kind: "ad",
    countries: ["US"],
    firstSeenAt: day(1),
    lastSeenAt: day(1),
    ...overrides,
  });

  beforeEach(async () => {
    t = await createTestDb();
    const [product] = await t.db
      .insert(products)
      .values({ slug: "ear-cleaner", title: "Ear Cleaner", firstSeenAt: day(60) })
      .returning();
    await t.db.insert(sourceItems).values([
      ad({
        title: "Smart ear cleaner",
        advertiserName: "Amblora",
        startedAt: day(54),
        productId: product.id,
      }),
      ad({ title: "Posture brace 100% fit", advertiserName: "Posture Co", startedAt: day(3) }),
      ad({
        title: "LED face mask",
        advertiserName: "Glow",
        countries: ["AU", "NZ"],
        startedAt: day(30),
        endedAt: day(2),
      }),
      ad({ source: "tiktok_ads", title: "Ear cleaner video", startedAt: day(10) }),
      ad({ provider: "fixture", title: "Sample ear ad", startedAt: day(90) }),
      // Not an ad: a store listing must never show up here.
      ad({ kind: "store_product", title: "Ear cleaner listing" }),
    ]);
  });

  afterEach(async () => {
    await t.close();
  });

  const titles = async (opts: Parameters<typeof getAds>[1]) =>
    (await getAds(t.db, { now: NOW, ...opts })).ads.map((a) => a.title);

  it("lists real ads only, longest-running first, with the matched product", async () => {
    const page = await getAds(t.db, { now: NOW });
    expect(page.total).toBe(4);
    expect(page.ads.map((a) => a.title)).toEqual([
      "Smart ear cleaner",
      "LED face mask",
      "Ear cleaner video",
      "Posture brace 100% fit",
    ]);
    expect(page.ads[0].product).toEqual({ slug: "ear-cleaner", title: "Ear Cleaner" });
    expect(page.ads[1].product).toBeNull();
  });

  it("includes sample ads only when asked", async () => {
    expect(await titles({ includeSample: true })).toContain("Sample ear ad");
  });

  it("searches titles and advertisers, word by word, with literal wildcards", async () => {
    expect(await titles({ q: "ear cleaner" })).toEqual(["Smart ear cleaner", "Ear cleaner video"]);
    expect(await titles({ q: "amblora" })).toEqual(["Smart ear cleaner"]);
    expect(await titles({ q: "100%" })).toEqual(["Posture brace 100% fit"]);
    expect(await titles({ q: "10%0" })).toEqual([]);
  });

  it("filters by market, platform and status", async () => {
    expect(await titles({ market: "NZ" })).toEqual(["LED face mask"]);
    expect(await titles({ platform: "tiktok_ads" })).toEqual(["Ear cleaner video"]);
    expect(await titles({ status: "stopped" })).toEqual(["LED face mask"]);
    expect(await titles({ status: "active" })).not.toContain("LED face mask");
  });

  it("sorts by newest and paginates", async () => {
    expect((await titles({ sort: "newest" }))[0]).toBe("Posture brace 100% fit");
    const page2 = await getAds(t.db, { now: NOW, page: 2 });
    expect(page2.ads).toEqual([]);
    expect(page2.pageCount).toBe(1);
    expect(AD_PAGE_SIZE).toBeGreaterThan(4);
  });
});

describe("parseAdParams", () => {
  it("keeps valid values and falls back to defaults", () => {
    expect(
      parseAdParams({
        q: " ear ",
        market: "us",
        platform: "tiktok_ads",
        status: "stopped",
        sort: "newest",
        page: "3",
        // The old sample-data switch is ignored: sample data is never shown.
        sample: "1",
      }),
    ).toEqual({
      q: "ear",
      market: "US",
      platform: "tiktok_ads",
      status: "stopped",
      sort: "newest",
      page: 3,
    });
    expect(
      parseAdParams({ market: "XX", platform: "myspace", status: "x", sort: "x", page: "-2" }),
    ).toEqual({
      q: undefined,
      market: undefined,
      platform: undefined,
      status: undefined,
      sort: "longest",
      page: 1,
    });
  });
});
