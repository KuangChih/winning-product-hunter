import { desc, inArray, sql } from "drizzle-orm";
import type { AnyDatabase } from "@/db/client";
import { productScores, products, sourceItems } from "@/db/schema";
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
  /** True when every piece of evidence comes from fixtures (sample data). */
  isSample: boolean;
}

/** Products ranked by their most recent Winning Score, highest first. */
export async function getRankedProducts(db: AnyDatabase, limit = 50): Promise<RankedProduct[]> {
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

  const top = latest.sort((a, b) => b.score - a.score).slice(0, limit);
  const ids = top.map((s) => s.productId);

  const [productRows, evidence] = await Promise.all([
    db.select().from(products).where(inArray(products.id, ids)),
    db
      .select({
        productId: sourceItems.productId,
        sources: sql<string[]>`array_agg(distinct ${sourceItems.source}::text)`,
        nonFixture: sql<number>`count(*) filter (where ${sourceItems.provider} <> 'fixture')`,
      })
      .from(sourceItems)
      .where(inArray(sourceItems.productId, ids))
      .groupBy(sourceItems.productId),
  ]);
  const productById = new Map(productRows.map((p) => [p.id, p]));
  const evidenceById = new Map(evidence.map((e) => [e.productId, e]));

  return top.flatMap((s) => {
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
        isSample: Number(e?.nonFixture ?? 0) === 0,
      },
    ];
  });
}
