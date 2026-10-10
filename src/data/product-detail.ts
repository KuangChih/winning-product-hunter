import { desc, eq, inArray } from "drizzle-orm";
import type { AnyDatabase } from "@/db/client";
import { productScores, products, signalSnapshots, sourceItems } from "@/db/schema";
import type { ScoreBreakdown } from "@/scoring/score";

export interface SeriesPoint {
  observedAt: Date;
  value: number;
}

export interface EvidenceItem {
  id: string;
  source: string;
  provider: string;
  kind: string;
  title: string | null;
  url: string | null;
  region: string | null;
  advertiserName: string | null;
  format: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
  priceCents: number | null;
  currency: string | null;
  /** Latest value per metric. */
  metrics: Record<string, number>;
  /** Full history for metrics with more than one observation (e.g. search interest). */
  series: Record<string, SeriesPoint[]>;
}

export interface ProductDetail {
  id: string;
  slug: string;
  title: string;
  imageUrl: string | null;
  firstSeenAt: Date;
  score: { score: number; confidence: number; computedAt: Date; breakdown: ScoreBreakdown } | null;
  scoreHistory: Array<{ score: number; computedAt: Date }>;
  evidence: EvidenceItem[];
  isSample: boolean;
}

export async function getProductDetail(
  db: AnyDatabase,
  slug: string,
): Promise<ProductDetail | null> {
  const [product] = await db.select().from(products).where(eq(products.slug, slug)).limit(1);
  if (!product) return null;

  const [scores, items] = await Promise.all([
    db
      .select()
      .from(productScores)
      .where(eq(productScores.productId, product.id))
      .orderBy(desc(productScores.computedAt))
      .limit(30),
    db.select().from(sourceItems).where(eq(sourceItems.productId, product.id)),
  ]);

  const snapshots = items.length
    ? await db
        .select()
        .from(signalSnapshots)
        .where(
          inArray(
            signalSnapshots.sourceItemId,
            items.map((i) => i.id),
          ),
        )
        .orderBy(signalSnapshots.observedAt)
    : [];

  const evidence: EvidenceItem[] = items.map((i) => {
    const own = snapshots.filter((s) => s.sourceItemId === i.id);
    const metrics: Record<string, number> = {};
    const series: Record<string, SeriesPoint[]> = {};
    for (const s of own) {
      metrics[s.metric] = s.value; // ordered by time, so the last write is the latest
      (series[s.metric] ??= []).push({ observedAt: s.observedAt, value: s.value });
    }
    for (const k of Object.keys(series)) if (series[k].length < 2) delete series[k];
    return {
      id: i.id,
      source: i.source,
      provider: i.provider,
      kind: i.kind,
      title: i.title,
      url: i.url,
      region: i.region,
      advertiserName: i.advertiserName,
      format: i.format,
      startedAt: i.startedAt,
      endedAt: i.endedAt,
      priceCents: i.priceCents,
      currency: i.currency,
      metrics,
      series,
    };
  });

  const latest = scores[0];
  return {
    id: product.id,
    slug: product.slug,
    title: product.title,
    imageUrl: product.imageUrl,
    firstSeenAt: product.firstSeenAt,
    score: latest
      ? {
          score: latest.score,
          confidence: latest.confidence,
          computedAt: latest.computedAt,
          breakdown: latest.breakdown as ScoreBreakdown,
        }
      : null,
    scoreHistory: scores.map((s) => ({ score: s.score, computedAt: s.computedAt })).reverse(),
    evidence,
    isSample: items.length > 0 && items.every((i) => i.provider === "fixture"),
  };
}
