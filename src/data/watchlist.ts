import { desc, eq, inArray } from "drizzle-orm";
import type { AnyDatabase } from "@/db/client";
import { productScores, products, watchlist } from "@/db/schema";

/** Score moves of at least this many points are highlighted as alerts. */
export const ALERT_THRESHOLD = 5;

export interface WatchedProduct {
  productId: string;
  slug: string;
  title: string;
  imageUrl: string | null;
  addedAt: Date;
  scoreAtAdd: number | null;
  /** Latest Winning Score; null until the product is scored. */
  score: number | null;
  scoredAt: Date | null;
  /** The score before the latest one, for the change since the last update. */
  previousScore: number | null;
}

export async function isWatched(db: AnyDatabase, productId: string): Promise<boolean> {
  const rows = await db
    .select({ id: watchlist.productId })
    .from(watchlist)
    .where(eq(watchlist.productId, productId))
    .limit(1);
  return rows.length > 0;
}

/** Adds a product, remembering its current score; adding twice keeps the first entry. */
export async function addToWatchlist(db: AnyDatabase, productId: string, now = new Date()) {
  const [latest] = await db
    .select({ score: productScores.score })
    .from(productScores)
    .where(eq(productScores.productId, productId))
    .orderBy(desc(productScores.computedAt))
    .limit(1);
  await db
    .insert(watchlist)
    .values({ productId, scoreAtAdd: latest?.score ?? null, addedAt: now })
    .onConflictDoNothing();
}

export async function removeFromWatchlist(db: AnyDatabase, productId: string) {
  await db.delete(watchlist).where(eq(watchlist.productId, productId));
}

/** Watched products with their latest and previous scores, most recently added first. */
export async function getWatchlist(db: AnyDatabase): Promise<WatchedProduct[]> {
  const rows = await db
    .select({
      productId: watchlist.productId,
      addedAt: watchlist.addedAt,
      scoreAtAdd: watchlist.scoreAtAdd,
      slug: products.slug,
      title: products.title,
      imageUrl: products.imageUrl,
    })
    .from(watchlist)
    .innerJoin(products, eq(watchlist.productId, products.id))
    .orderBy(desc(watchlist.addedAt));
  if (rows.length === 0) return [];

  const scores = await db
    .select({
      productId: productScores.productId,
      score: productScores.score,
      computedAt: productScores.computedAt,
    })
    .from(productScores)
    .where(
      inArray(
        productScores.productId,
        rows.map((r) => r.productId),
      ),
    )
    .orderBy(desc(productScores.computedAt));
  const byProduct = new Map<string, typeof scores>();
  for (const s of scores) {
    const list = byProduct.get(s.productId) ?? [];
    if (list.length < 2) list.push(s);
    byProduct.set(s.productId, list);
  }

  return rows.map((r) => {
    const [latest, previous] = byProduct.get(r.productId) ?? [];
    return {
      ...r,
      score: latest?.score ?? null,
      scoredAt: latest?.computedAt ?? null,
      previousScore: previous?.score ?? null,
    };
  });
}

/** Difference between two scores, or null when either is missing. */
export function scoreChange(current: number | null, before: number | null): number | null {
  return current === null || before === null ? null : current - before;
}

/** Products whose score moved by at least the threshold since the last update. */
export function scoreAlerts(items: WatchedProduct[], threshold = ALERT_THRESHOLD) {
  return items.filter((i) => {
    const change = scoreChange(i.score, i.previousScore);
    return change !== null && Math.abs(change) >= threshold;
  });
}
