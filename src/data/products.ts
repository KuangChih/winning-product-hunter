import { desc, eq, inArray, sql } from "drizzle-orm";
import type { AnyDatabase } from "@/db/client";
import { productScores, products, sourceItems } from "@/db/schema";
import { sortByMarketPriority } from "@/lib/markets";
import type { ScoreBreakdown } from "@/scoring/score";

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
}

export type RankingSort = "score" | "newest" | "least_crowded";

export interface RankingFilters {
  /** Case-insensitive title search; every word must match. */
  q?: string;
  /** ISO country the product must have evidence in. */
  market?: string;
  minScore?: number;
  sort?: RankingSort;
}

export interface RankingOptions extends RankingFilters {
  limit?: number;
  /** Include products with any sample (fixture) evidence. Off by default. */
  includeSample?: boolean;
}

/** Applies search, filters and sort to ranked products (pure, so it is easy to test). */
export function applyRankingFilters(
  items: RankedProduct[],
  { q, market, minScore, sort = "score" }: RankingFilters,
): RankedProduct[] {
  const words = (q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const filtered = items.filter(
    (p) =>
      words.every((w) => p.title.toLowerCase().includes(w)) &&
      (!market || p.markets.includes(market)) &&
      (minScore === undefined || p.score >= minScore),
  );
  const by: Record<RankingSort, (a: RankedProduct, b: RankedProduct) => number> = {
    score: (a, b) => b.score - a.score,
    // Youngest products first: the earliest evidence is the most recent.
    newest: (a, b) =>
      a.breakdown.saturation.ageDays - b.breakdown.saturation.ageDays || b.score - a.score,
    least_crowded: (a, b) =>
      a.breakdown.saturation.penalty - b.breakdown.saturation.penalty || b.score - a.score,
  };
  return filtered.sort(by[sort] ?? by.score);
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

  const [productRows, evidence] = await Promise.all([
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
  ]);
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
      },
    ];
  });
  return applyRankingFilters(all, filters).slice(0, limit);
}
