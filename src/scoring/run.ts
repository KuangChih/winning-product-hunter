import { inArray, isNotNull } from "drizzle-orm";
import type { AnyDatabase } from "@/db/client";
import { productScores, products, signalSnapshots, sourceItems } from "@/db/schema";
import { extractFeatures, type ItemInput } from "./features";
import { SCORING_VERSION, scoreProducts } from "./score";

/** Scores every product that has at least one source item and appends rows to product_scores. */
export async function runScoring(db: AnyDatabase, now: Date = new Date()) {
  const items = await db.select().from(sourceItems).where(isNotNull(sourceItems.productId));
  if (items.length === 0) return { productsScored: 0 };

  const snapshots = await db
    .select()
    .from(signalSnapshots)
    .where(
      inArray(
        signalSnapshots.sourceItemId,
        items.map((i) => i.id),
      ),
    );
  const snapsByItem = new Map<string, ItemInput["snapshots"]>();
  for (const s of snapshots) {
    const list = snapsByItem.get(s.sourceItemId) ?? [];
    list.push({ metric: s.metric, value: s.value, observedAt: s.observedAt });
    snapsByItem.set(s.sourceItemId, list);
  }

  const productIds = [...new Set(items.map((i) => i.productId!))];
  const productRows = await db.select().from(products).where(inArray(products.id, productIds));

  const features = productRows.map((p) =>
    extractFeatures(
      items
        .filter((i) => i.productId === p.id)
        .map((i) => ({
          source: i.source,
          kind: i.kind,
          advertiserId: i.advertiserId,
          format: i.format,
          startedAt: i.startedAt,
          endedAt: i.endedAt,
          priceCents: i.priceCents,
          snapshots: snapsByItem.get(i.id) ?? [],
        })),
      p.firstSeenAt,
      now,
    ),
  );
  const scores = scoreProducts(features);

  await db.insert(productScores).values(
    productRows.map((p, i) => ({
      productId: p.id,
      scoringVersion: SCORING_VERSION,
      score: scores[i].score,
      confidence: scores[i].confidence,
      breakdown: scores[i].breakdown,
      computedAt: now,
    })),
  );
  return { productsScored: productRows.length };
}
