import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { AnyDatabase } from "@/db/client";
import { productScores, products, sourceItems } from "@/db/schema";
import { sortByMarketPriority } from "@/lib/markets";
import { marketRetailPrice, OWN_LISTING_PROVIDER } from "@/lib/retail-price";
import { getLatestFxRates } from "./fx";
import { type ScoreBreakdown, SUB_SCORE_ORDER, type SubScoreName } from "@/scoring/score";

export interface RankedProduct {
  id: string;
  slug: string;
  title: string;
  category: string | null;
  imageUrl: string | null;
  score: number;
  confidence: number;
  computedAt: Date;
  breakdown: ScoreBreakdown;
  sources: string[];
  /** ISO countries the evidence covers, target markets first. */
  markets: string[];
  /** True when any evidence comes from fixtures (sample data), so the score is not real. */
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
  limit?: number;
  /** Include products with any sample (fixture) evidence. Off by default. */
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

/** Products ranked by their most recent Winning Score, highest first. */
export async function getRankedProducts(
  db: AnyDatabase,
  { limit = 50, includeSample = false, ...filters }: RankingOptions = {},
): Promise<RankedProduct[]> {
  const latest = await db
    .selectDistinctOn([productScores.productId], {
      productId: productScores.productId,
      score: productScores.score,
      confidence: productScores.confidence,
      computedAt: productScores.computedAt,
      breakdown: productScores.breakdown,
    })
    .from(productScores)
    .orderBy(productScores.productId, desc(productScores.computedAt));
  if (latest.length === 0) return [];

  // Products with any fixture evidence are sample data; filter before taking the top N.
  const sampleIds = includeSample
    ? new Set<string>()
    : new Set(
        (
          await db
            .selectDistinct({ productId: sourceItems.productId })
            .from(sourceItems)
            .where(eq(sourceItems.provider, "fixture"))
        ).map((r) => r.productId),
      );
  const top = latest.filter((s) => !sampleIds.has(s.productId)).sort((a, b) => b.score - a.score);
  if (top.length === 0) return [];
  const ids = top.map((s) => s.productId);

  const [productRows, evidence, offers, fx] = await Promise.all([
    db.select().from(products).where(inArray(products.id, ids)),
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
      .where(inArray(sourceItems.productId, ids))
      .groupBy(sourceItems.productId),
    db
      .select({
        productId: sourceItems.productId,
        priceCents: sourceItems.priceCents,
        currency: sourceItems.currency,
      })
      .from(sourceItems)
      .where(
        and(
          inArray(sourceItems.productId, ids),
          eq(sourceItems.kind, "store_product"),
          eq(sourceItems.provider, OWN_LISTING_PROVIDER),
        ),
      ),
    getLatestFxRates(db),
  ]);
  const offersById = new Map<string, Array<{ priceCents: number; currency: string | null }>>();
  for (const o of offers) {
    if (o.productId === null || o.priceCents === null) continue;
    const list = offersById.get(o.productId) ?? [];
    list.push({ priceCents: o.priceCents, currency: o.currency });
    offersById.set(o.productId, list);
  }
  const productById = new Map(productRows.map((p) => [p.id, p]));
  const evidenceById = new Map(evidence.map((e) => [e.productId, e]));

  const all = top.flatMap((s) => {
    const p = productById.get(s.productId);
    if (!p) return [];
    const e = evidenceById.get(s.productId);
    return [
      {
        id: p.id,
        slug: p.slug,
        title: p.title,
        category: p.category,
        imageUrl: p.imageUrl,
        score: s.score,
        confidence: s.confidence,
        computedAt: s.computedAt,
        breakdown: s.breakdown as ScoreBreakdown,
        sources: [...(e?.sources ?? [])].sort(),
        markets: sortByMarketPriority(e?.countries ?? []),
        isSample: Number(e?.fixture ?? 0) > 0,
        retailUsdCents:
          marketRetailPrice(offersById.get(p.id) ?? [], "US", fx)?.medianCents ?? null,
      },
    ];
  });
  return applyRankingFilters(all, filters).slice(0, limit);
}
