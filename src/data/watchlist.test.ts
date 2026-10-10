// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { products, productScores, sourceItems } from "@/db/schema";
import { createTestDb } from "@/db/testing/pglite";
import {
  addToWatchlist,
  getWatchedIds,
  getWatchlist,
  isWatched,
  removeFromWatchlist,
  scoreAlerts,
  scoreChange,
  type WatchedProduct,
} from "./watchlist";

const NOW = new Date("2026-10-10T00:00:00Z");
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe("watchlist", () => {
  let t: Awaited<ReturnType<typeof createTestDb>>;
  let a: string;
  let b: string;

  beforeEach(async () => {
    t = await createTestDb();
    const rows = await t.db
      .insert(products)
      .values([
        { slug: "ear-cleaner", title: "Ear Cleaner", firstSeenAt: day(30) },
        { slug: "neck-fan", title: "Neck Fan", firstSeenAt: day(10) },
      ])
      .returning();
    [a, b] = rows.map((r) => r.id);
    const score = (productId: string, value: number, d: number) => ({
      productId,
      scoringVersion: "v1.1",
      score: value,
      confidence: 0.5,
      breakdown: {},
      computedAt: day(d),
    });
    await t.db.insert(productScores).values([score(a, 60, 3), score(a, 52, 2)]);
  });

  afterEach(async () => {
    await t.close();
  });

  it("adds, lists and removes products, remembering the score when added", async () => {
    expect(await getWatchlist(t.db)).toEqual([]);
    await addToWatchlist(t.db, a, day(2));
    await addToWatchlist(t.db, b, day(1));
    await addToWatchlist(t.db, a, NOW); // already watched: keeps the first entry

    expect(await isWatched(t.db, a)).toBe(true);
    const list = await getWatchlist(t.db);
    expect(list.map((w) => w.slug)).toEqual(["neck-fan", "ear-cleaner"]);
    expect(list[1]).toMatchObject({
      scoreAtAdd: 52,
      score: 52,
      previousScore: 60,
      addedAt: day(2),
    });
    // Not scored yet: no numbers, but still listed.
    expect(list[0]).toMatchObject({ scoreAtAdd: null, score: null, previousScore: null });

    await removeFromWatchlist(t.db, a);
    expect(await isWatched(t.db, a)).toBe(false);
    expect((await getWatchlist(t.db)).map((w) => w.slug)).toEqual(["neck-fan"]);
  });

  it("tells which of several products are watched in one call", async () => {
    expect(await getWatchedIds(t.db, [])).toEqual(new Set());
    expect(await getWatchedIds(t.db, [a, b])).toEqual(new Set());
    await addToWatchlist(t.db, b, day(1));
    expect(await getWatchedIds(t.db, [a, b])).toEqual(new Set([b]));
    expect(await getWatchedIds(t.db, [a])).toEqual(new Set());
  });

  it("leaves out products with sample (fixture) evidence", async () => {
    const item = (productId: string, provider: string, externalId: string) => ({
      source: "meta_ads" as const,
      provider,
      externalId,
      kind: "ad" as const,
      productId,
      firstSeenAt: NOW,
      lastSeenAt: NOW,
    });
    await t.db
      .insert(sourceItems)
      .values([item(a, "fixture", "sample-1"), item(b, "ad_library_web", "real-1")]);
    await addToWatchlist(t.db, a, day(2));
    await addToWatchlist(t.db, b, day(1));
    expect((await getWatchlist(t.db)).map((w) => w.slug)).toEqual(["neck-fan"]);
  });
});

describe("score alerts", () => {
  const item = (score: number | null, previousScore: number | null) =>
    ({ score, previousScore }) as WatchedProduct;

  it("computes changes only when both scores exist", () => {
    expect(scoreChange(52, 60)).toBe(-8);
    expect(scoreChange(null, 60)).toBeNull();
    expect(scoreChange(52, null)).toBeNull();
  });

  it("flags moves of at least the threshold in either direction", () => {
    const up = item(70, 64);
    const down = item(52, 60);
    const small = item(61, 60);
    const unscored = item(null, null);
    expect(scoreAlerts([up, down, small, unscored])).toEqual([up, down]);
  });
});
