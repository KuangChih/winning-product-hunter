import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { AnyDatabase } from "@/db/client";
import { products, productScores, sourceItems } from "@/db/schema";
import { advertiserTarget } from "@/ingestion/sources/meta-ad-library-web";
import { MARKETS, marketTier } from "@/lib/markets";

/**
 * Advertiser following (Phase 4C): stores that sell physical products test many of them at
 * once, so their other ads surface new products earlier than keyword sweeps do.
 */
export interface FollowedAdvertiser {
  pageId: string;
  name: string | null;
  /** Market to look at: where most of their ads run, priority markets first. */
  country: string;
  /** Best latest Winning Score among their products (null until scored). */
  bestScore: number | null;
  /** Ads seen so far that point at a store product page. */
  productPageAds: number;
}

/** Ads pointing at a store product page (Shopify `/products/<handle>` and similar). */
const PRODUCT_PAGE = "%/products/%";

/** Ranked advertisers worth following: e-commerce stores, those with the best products first. */
export async function rankAdvertisers(db: AnyDatabase): Promise<FollowedAdvertiser[]> {
  const ads = await db
    .select({
      pageId: sourceItems.advertiserId,
      name: sourceItems.advertiserName,
      countries: sourceItems.countries,
      productId: sourceItems.productId,
    })
    .from(sourceItems)
    .innerJoin(products, eq(sourceItems.productId, products.id))
    .where(
      and(
        eq(sourceItems.kind, "ad"),
        eq(sourceItems.provider, "ad_library_web"),
        isNotNull(sourceItems.advertiserId),
        isNull(products.mergedInto),
        sql`${sourceItems.raw}->>'landing_url' like ${PRODUCT_PAGE}`,
      ),
    );
  if (ads.length === 0) return [];

  // Products with any sample (fixture) evidence must not steer real discovery: their scores
  // mix in generated data (core rule: real data only).
  const sampleIds = new Set(
    (
      await db
        .selectDistinct({ productId: sourceItems.productId })
        .from(sourceItems)
        .where(eq(sourceItems.provider, "fixture"))
    ).map((r) => r.productId),
  );
  const realAds = ads.filter((a) => !sampleIds.has(a.productId));
  if (realAds.length === 0) return [];

  const productIds = [...new Set(realAds.map((a) => a.productId!))];
  const scores = await db
    .selectDistinctOn([productScores.productId], {
      productId: productScores.productId,
      score: productScores.score,
    })
    .from(productScores)
    .where(inArray(productScores.productId, productIds))
    .orderBy(productScores.productId, desc(productScores.computedAt));
  const scoreOf = new Map(scores.map((s) => [s.productId, s.score]));

  const byPage = new Map<string, FollowedAdvertiser & { countryCounts: Map<string, number> }>();
  for (const ad of realAds) {
    const pageId = ad.pageId!;
    const entry = byPage.get(pageId) ?? {
      pageId,
      name: ad.name,
      country: "US",
      bestScore: null,
      productPageAds: 0,
      countryCounts: new Map<string, number>(),
    };
    entry.productPageAds++;
    const score = scoreOf.get(ad.productId!);
    if (score !== undefined && (entry.bestScore === null || score > entry.bestScore)) {
      entry.bestScore = score;
    }
    for (const c of ad.countries) entry.countryCounts.set(c, (entry.countryCounts.get(c) ?? 0) + 1);
    byPage.set(pageId, entry);
  }

  const order = (c: string) => MARKETS.findIndex((m) => m.code === c);
  return [...byPage.values()]
    .map(({ countryCounts, ...a }) => {
      const priority = [...countryCounts.entries()]
        .filter(([c]) => marketTier(c) === 1)
        .sort((x, y) => y[1] - x[1] || order(x[0]) - order(y[0]));
      return { ...a, country: priority[0]?.[0] ?? "US" };
    })
    .sort(
      (a, b) =>
        (b.bestScore ?? -1) - (a.bestScore ?? -1) ||
        b.productPageAds - a.productPageAds ||
        a.pageId.localeCompare(b.pageId),
    );
}

/**
 * Today's advertisers to follow: a window over the top `pool` ranked advertisers that advances
 * daily, so the best stores are revisited every few days without exceeding the request cap.
 * With `slotsPerDay` sweeps a day, sweep `slot` (0-based) moves on to its own window.
 */
export async function pickAdvertisers(
  db: AnyDatabase,
  count: number,
  {
    day = new Date(),
    poolFactor = 5,
    slot = 0,
    slotsPerDay = 1,
  }: { day?: Date; poolFactor?: number; slot?: number; slotsPerDay?: number } = {},
): Promise<FollowedAdvertiser[]> {
  const pool = (await rankAdvertisers(db)).slice(0, count * poolFactor);
  if (pool.length <= count) return pool;
  const window = Math.floor(day.getTime() / 86_400_000) * slotsPerDay + slot;
  const start = (window * count) % pool.length;
  return Array.from({ length: count }, (_, i) => pool[(start + i) % pool.length]);
}

export function advertiserTargets(advertisers: FollowedAdvertiser[]): string[] {
  return advertisers.map((a) => advertiserTarget(a.pageId, a.country));
}
