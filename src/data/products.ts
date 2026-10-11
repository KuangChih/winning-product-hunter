import { and, asc, desc, eq, inArray, isNotNull, isNull, notExists, or, sql } from "drizzle-orm";
import type { AnyDatabase } from "@/db/client";
import { productScores, products, sourceItems } from "@/db/schema";
import { sortByMarketPriority } from "@/lib/markets";
import { OWN_LISTING_PROVIDER, productRetailPrice, type RetailItem } from "@/lib/retail-price";
import { SEARCH_LISTING_PROVIDER, samePhotoOf } from "@/matching/same-photo";
import { getLatestFxRates } from "./fx";
import { type ScoreBreakdown, SUB_SCORE_ORDER, type SubScoreName } from "@/scoring/score";

export interface RankedProduct {
  id: string;
  slug: string;
  title: string;
  category: string | null;
  imageUrl: string | null;
  /** When we first found the product. */
  firstSeenAt: Date;
  score: number;
  confidence: number;
  computedAt: Date;
  breakdown: ScoreBreakdown;
  sources: string[];
  /** ISO countries the evidence covers, target markets first. */
  markets: string[];
  /** True when any evidence comes from fixtures (sample data); only tests ever see these. */
  isSample: boolean;
  /** The advertiser's own store price in USD cents (ECB-converted); similar products excluded. */
  retailUsdCents: number | null;
}

/** Overall score, age, crowdedness, or any single sub-score (highest first, no data last). */
export type RankingSort = "score" | "newest" | "least_crowded" | SubScoreName;

/** Per-signal filter: the signal must have real data, or reach a minimum (0–100). */
export type SignalFilter = "data" | number;

/** A sub-score as shown to users (0–100), or null when the product has no data for it. */
export function signalValue(p: RankedProduct, name: SubScoreName): number | null {
  const v = p.breakdown.subScores?.[name]?.value;
  return v === null || v === undefined ? null : Math.round(v * 100);
}

function matchesSignals(p: RankedProduct, signals: RankingFilters["signals"]) {
  if (!signals) return true;
  return SUB_SCORE_ORDER.every((name) => {
    const rule = signals[name];
    if (rule === undefined) return true;
    const v = signalValue(p, name);
    return v !== null && (rule === "data" || v >= rule);
  });
}

export interface RankingFilters {
  /** Case-insensitive title search; every word must match. */
  q?: string;
  /** ISO country the product must have evidence in. */
  market?: string;
  minScore?: number;
  /** US retail price range in whole USD; products without a known price are excluded. */
  minPrice?: number;
  maxPrice?: number;
  /** Evidence source the product must have (e.g. "meta_ads", "shopify"). */
  source?: string;
  /** Sub-score filters, e.g. `{ longevity: 60, momentum: "data" }`. */
  signals?: Partial<Record<SubScoreName, SignalFilter>>;
  sort?: RankingSort;
}

export interface RankingOptions extends RankingFilters {
  /** Keep only the first N after filtering and sorting; all by default (pages slice them). */
  limit?: number;
  /**
   * Include products with any sample (fixture) evidence: for tests that seed fixtures only. The
   * website never passes it (sample data is never shown).
   */
  includeSample?: boolean;
}

function inPriceRange(cents: number | null, min?: number, max?: number) {
  if (min === undefined && max === undefined) return true;
  if (cents === null) return false;
  return (min === undefined || cents >= min * 100) && (max === undefined || cents <= max * 100);
}

/** Applies search, filters and sort to ranked products (pure, so it is easy to test). */
export function applyRankingFilters(
  items: RankedProduct[],
  { q, market, minScore, minPrice, maxPrice, source, signals, sort = "score" }: RankingFilters,
): RankedProduct[] {
  const words = (q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const filtered = items.filter(
    (p) =>
      words.every((w) => p.title.toLowerCase().includes(w)) &&
      (!market || p.markets.includes(market)) &&
      (minScore === undefined || p.score >= minScore) &&
      (!source || p.sources.includes(source)) &&
      inPriceRange(p.retailUsdCents, minPrice, maxPrice) &&
      matchesSignals(p, signals),
  );
  if ((SUB_SCORE_ORDER as string[]).includes(sort)) {
    const name = sort as SubScoreName;
    // Highest sub-score first; products without data for it go last, then by overall score.
    return filtered.sort((a, b) => {
      const va = signalValue(a, name);
      const vb = signalValue(b, name);
      if (va === null || vb === null)
        return (va === null ? 1 : 0) - (vb === null ? 1 : 0) || b.score - a.score;
      return vb - va || b.score - a.score;
    });
  }
  const by: Record<
    "score" | "newest" | "least_crowded",
    (a: RankedProduct, b: RankedProduct) => number
  > = {
    score: (a, b) => b.score - a.score,
    // Youngest products first: the earliest evidence is the most recent.
    newest: (a, b) =>
      a.breakdown.saturation.ageDays - b.breakdown.saturation.ageDays || b.score - a.score,
    least_crowded: (a, b) =>
      a.breakdown.saturation.penalty - b.breakdown.saturation.penalty || b.score - a.score,
  };
  return filtered.sort(by[sort as keyof typeof by] ?? by.score);
}

/**
 * The latest scoring batch. `runScoring` scores every product with evidence in one INSERT with
 * one `computed_at`, so the newest batch holds each live product's latest score; reading only
 * that batch uses `product_scores_rank_idx` instead of scanning every past score. Products that
 * are missing from it lost all their evidence (e.g. merged into another product) and are stale.
 */
const latestBatch = sql`${productScores.computedAt} = (select max(${productScores.computedAt}) from ${productScores})`;

/** Products ranked by their most recent Winning Score, highest first. */
export async function getRankedProducts(
  db: AnyDatabase,
  { limit, includeSample = false, ...filters }: RankingOptions = {},
): Promise<RankedProduct[]> {
  // Sample (fixture) products are left out in SQL, before any filter, sort or limit.
  const real = includeSample
    ? undefined
    : notExists(
        db
          .select({ one: sql`1` })
          .from(sourceItems)
          .where(
            and(
              eq(sourceItems.productId, productScores.productId),
              eq(sourceItems.provider, "fixture"),
            ),
          ),
      );
  const rankedIds = db
    .select({ id: productScores.productId })
    .from(productScores)
    .where(and(latestBatch, real));

  // Independent queries run together (PGlite serializes them; Neon runs them in parallel).
  const [top, evidence, offers, fx] = await Promise.all([
    db
      .select({
        productId: productScores.productId,
        score: productScores.score,
        confidence: productScores.confidence,
        computedAt: productScores.computedAt,
        breakdown: productScores.breakdown,
        slug: products.slug,
        title: products.title,
        category: products.category,
        imageUrl: products.imageUrl,
        imageHash: products.imageHash,
        firstSeenAt: products.firstSeenAt,
      })
      .from(productScores)
      .innerJoin(products, eq(products.id, productScores.productId))
      .where(and(latestBatch, real, isNull(products.mergedInto)))
      // Ties by product id, as before (a stable order across requests and pages).
      .orderBy(desc(productScores.score), asc(productScores.productId)),
    db
      .select({
        productId: sourceItems.productId,
        sources: sql<string[]>`array_agg(distinct ${sourceItems.source}::text)`,
        fixture: sql<number>`count(*) filter (where ${sourceItems.provider} = 'fixture')`,
        countries: sql<
          string[]
        >`coalesce(array_agg(distinct c) filter (where c is not null), '{}')`,
      })
      .from(sourceItems)
      .leftJoin(sql`lateral unnest(${sourceItems.countries}) as c`, sql`true`)
      .where(inArray(sourceItems.productId, rankedIds))
      .groupBy(sourceItems.productId),
    db
      .select({
        productId: sourceItems.productId,
        provider: sourceItems.provider,
        priceCents: sourceItems.priceCents,
        currency: sourceItems.currency,
        advertiserId: sourceItems.advertiserId,
        countries: sourceItems.countries,
        title: sourceItems.title,
        imageHash: sourceItems.imageHash,
      })
      .from(sourceItems)
      .where(
        and(
          inArray(sourceItems.productId, rankedIds),
          eq(sourceItems.kind, "store_product"),
          isNotNull(sourceItems.priceCents),
          // Own listings, and search results whose photo was hashed (same-photo prices).
          or(
            eq(sourceItems.provider, OWN_LISTING_PROVIDER),
            and(
              eq(sourceItems.provider, SEARCH_LISTING_PROVIDER),
              isNotNull(sourceItems.imageHash),
            ),
          ),
        ),
      ),
    getLatestFxRates(db),
  ]);
  if (top.length === 0) return [];
  const photoOf = new Map(top.map((p) => [p.productId, p]));
  const offersById = new Map<string, RetailItem[]>();
  for (const { productId, title, imageHash, ...o } of offers) {
    if (productId === null) continue;
    const list = offersById.get(productId) ?? [];
    list.push({
      ...o,
      kind: "store_product",
      samePhoto:
        o.provider === SEARCH_LISTING_PROVIDER
          ? samePhotoOf(photoOf.get(productId), { imageHash, title })
          : undefined,
    });
    offersById.set(productId, list);
  }
  const evidenceById = new Map(evidence.map((e) => [e.productId, e]));

  const all = top.map((s): RankedProduct => {
    const e = evidenceById.get(s.productId);
    return {
      id: s.productId,
      slug: s.slug,
      title: s.title,
      category: s.category,
      imageUrl: s.imageUrl,
      firstSeenAt: s.firstSeenAt,
      score: s.score,
      confidence: s.confidence,
      computedAt: s.computedAt,
      breakdown: s.breakdown as ScoreBreakdown,
      sources: [...(e?.sources ?? [])].sort(),
      markets: sortByMarketPriority(e?.countries ?? []),
      isSample: Number(e?.fixture ?? 0) > 0,
      retailUsdCents:
        productRetailPrice(offersById.get(s.productId) ?? [], fx)?.medianCents ?? null,
    };
  });
  const ranked = applyRankingFilters(all, filters);
  return limit === undefined ? ranked : ranked.slice(0, limit);
}
