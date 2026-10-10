import { and, eq, inArray, isNull } from "drizzle-orm";
import type { AnyDatabase } from "@/db/client";
import { productScores, products, sourceItems, watchlist } from "@/db/schema";
import { fetchWithRetry, type RetryOptions } from "@/ingestion/http";
import { dHash, hammingDistance } from "./image-hash";
import { jaccard, titleTokens } from "./normalize";

/** Thresholds for treating two products as the same item (tunable with a labeled set). */
export const MERGE_RULES = {
  /** Near-identical photo: same product even if titles differ (different store names). */
  identicalImage: 2,
  /** Similar photo: same product only if titles also overlap. */
  similarImage: 8,
  minTitleJaccard: 0.25,
};

export interface HashCandidate {
  id: string;
  title: string;
  imageHash: string;
  firstSeenAt: Date;
}

/**
 * Groups products that are the same item by photo (dHash) and title. Returns one group per
 * merged set; the first id in each group is the survivor (the earliest seen product).
 */
export function findDuplicateGroups(candidates: HashCandidate[]): string[][] {
  const parent = new Map(candidates.map((c) => [c.id, c.id]));
  const find = (id: string): string => {
    const p = parent.get(id)!;
    if (p === id) return id;
    const root = find(p);
    parent.set(id, root);
    return root;
  };
  const tokens = new Map(candidates.map((c) => [c.id, titleTokens(c.title)]));

  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i];
      const b = candidates[j];
      const distance = hammingDistance(a.imageHash, b.imageHash);
      const same =
        distance <= MERGE_RULES.identicalImage ||
        (distance <= MERGE_RULES.similarImage &&
          jaccard(tokens.get(a.id)!, tokens.get(b.id)!) >= MERGE_RULES.minTitleJaccard);
      if (same) parent.set(find(a.id), find(b.id));
    }
  }

  const groups = new Map<string, HashCandidate[]>();
  for (const c of candidates) {
    const root = find(c.id);
    groups.set(root, [...(groups.get(root) ?? []), c]);
  }
  return [...groups.values()]
    .filter((g) => g.length > 1)
    .map((g) =>
      g
        .sort(
          (x, y) => x.firstSeenAt.getTime() - y.firstSeenAt.getTime() || x.id.localeCompare(y.id),
        )
        .map((c) => c.id),
    );
}

/**
 * Computes dHash for active products that have none yet. The photo comes from the product
 * itself or, failing that, from its store listings (advertisers' own listings first).
 */
export async function hashProductImages(
  db: AnyDatabase,
  { limit = 100, retry }: { limit?: number; retry?: RetryOptions } = {},
): Promise<{ hashed: number; failed: number }> {
  const pending = await db
    .select({ id: products.id, imageUrl: products.imageUrl })
    .from(products)
    .where(and(isNull(products.imageHash), isNull(products.mergedInto)))
    .limit(limit);
  if (pending.length === 0) return { hashed: 0, failed: 0 };

  const listings = await db
    .select({
      productId: sourceItems.productId,
      imageUrl: sourceItems.imageUrl,
      provider: sourceItems.provider,
    })
    .from(sourceItems)
    .where(
      inArray(
        sourceItems.productId,
        pending.map((p) => p.id),
      ),
    );

  let hashed = 0;
  let failed = 0;
  for (const p of pending) {
    const own = listings.filter((l) => l.productId === p.id && l.imageUrl);
    const url =
      p.imageUrl ??
      own.find((l) => l.provider === "shopify_catalog_lookup")?.imageUrl ??
      own[0]?.imageUrl;
    if (!url) continue;
    try {
      const res = await fetchWithRetry(url, {}, { retries: 1, ...retry });
      const hash = await dHash(Buffer.from(await res.arrayBuffer()));
      await db
        .update(products)
        .set({ imageHash: hash, imageUrl: p.imageUrl ?? url })
        .where(eq(products.id, p.id));
      hashed++;
    } catch {
      failed++;
    }
  }
  return { hashed, failed };
}

/**
 * Merges duplicate products: evidence moves to the survivor, the duplicates' scores are dropped
 * (they are recomputed for the survivor) and duplicates are marked `merged_into`.
 */
export async function mergeDuplicateProducts(db: AnyDatabase): Promise<{ merged: number }> {
  const rows = await db
    .select({
      id: products.id,
      title: products.title,
      imageHash: products.imageHash,
      firstSeenAt: products.firstSeenAt,
    })
    .from(products)
    .where(isNull(products.mergedInto));
  const groups = findDuplicateGroups(
    rows.flatMap((r) => (r.imageHash ? [{ ...r, imageHash: r.imageHash }] : [])),
  );

  let merged = 0;
  for (const [survivor, ...duplicates] of groups) {
    await db
      .update(sourceItems)
      .set({ productId: survivor })
      .where(inArray(sourceItems.productId, duplicates));
    await db.delete(productScores).where(inArray(productScores.productId, duplicates));
    // Keep following a merged product: the earliest watch moves to the survivor.
    const [watched] = await db
      .select()
      .from(watchlist)
      .where(inArray(watchlist.productId, duplicates))
      .orderBy(watchlist.addedAt)
      .limit(1);
    if (watched) {
      await db
        .insert(watchlist)
        .values({ ...watched, productId: survivor })
        .onConflictDoNothing();
      await db.delete(watchlist).where(inArray(watchlist.productId, duplicates));
    }
    await db.update(products).set({ mergedInto: survivor }).where(inArray(products.id, duplicates));
    merged += duplicates.length;
  }
  return { merged };
}
