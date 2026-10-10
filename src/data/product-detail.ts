import { and, desc, eq, exists, inArray, not } from "drizzle-orm";
import type { AnyDatabase } from "@/db/client";
import { productScores, products, signalSnapshots, sourceItems } from "@/db/schema";
import type { FxRates } from "@/lib/fx";
import type { ScoreBreakdown } from "@/scoring/score";
import { getLatestFxRates } from "./fx";

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
  countries: string[];
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
  /** Latest ECB rates, for showing prices from several currencies together. */
  fxRates: FxRates | null;
}

/** Products with any sample (fixture) evidence: never shown on the website. */
const hasSampleEvidence = (db: AnyDatabase) =>
  exists(
    db
      .select({ one: sourceItems.id })
      .from(sourceItems)
      .where(and(eq(sourceItems.productId, products.id), eq(sourceItems.provider, "fixture"))),
  );

/** Title for the page metadata, without loading the evidence (null for sample products). */
export async function getProductTitle(db: AnyDatabase, slug: string): Promise<string | null> {
  const [row] = await db
    .select({ title: products.title })
    .from(products)
    .where(and(eq(products.slug, slug), not(hasSampleEvidence(db))))
    .limit(1);
  return row?.title ?? null;
}

/** A product merged into another as a duplicate: its page should point at the survivor. */
export interface MergedProduct {
  redirectTo: string;
}

/** Longest merge chain we follow; dedupe points losers straight at survivors, so 1 is typical. */
const MAX_MERGE_HOPS = 5;

export interface ProductDetailOptions {
  /**
   * Return sample (fixture) products too: for tests that seed fixtures only. The website never
   * passes it, so a sample product's page is "not found".
   */
  includeSample?: boolean;
}

export async function getProductDetail(
  db: AnyDatabase,
  slug: string,
  { includeSample = false }: ProductDetailOptions = {},
): Promise<ProductDetail | MergedProduct | null> {
  let [product] = await db.select().from(products).where(eq(products.slug, slug)).limit(1);
  if (!product) return null;
  if (product.mergedInto) {
    for (let hop = 0; product.mergedInto && hop < MAX_MERGE_HOPS; hop++) {
      const [next] = await db
        .select()
        .from(products)
        .where(eq(products.id, product.mergedInto))
        .limit(1);
      if (!next) return null;
      product = next;
    }
    return product.mergedInto ? null : { redirectTo: product.slug };
  }

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
      countries: i.countries,
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

  const isSample = items.some((i) => i.provider === "fixture");
  if (isSample && !includeSample) return null;

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
    isSample,
    fxRates: await getLatestFxRates(db),
  };
}
