import { and, desc, eq, isNotNull, isNull, max, sql } from "drizzle-orm";
import type { AnyDatabase } from "@/db/client";
import { products, sourceItems } from "@/db/schema";
import type { RetryOptions } from "@/ingestion/http";
import { dHash } from "./image-hash";
import { fetchImage, isAllowedImageUrl, MAX_IMAGE_BYTES, readCapped } from "./merge";
import { SEARCH_LISTING_PROVIDER } from "./same-photo";

/** Stored instead of a hash when a photo cannot be used (not retried until its URL changes). */
export const UNUSABLE_PHOTO = "-";

/**
 * Shopify's CDN resizes on request: a 256 px thumbnail is plenty for a 9×8 dHash and a fraction
 * of the original's bytes. Other hosts get the URL unchanged.
 */
export function thumbnailUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname !== "cdn.shopify.com") return url;
    u.searchParams.set("width", "256");
    return u.toString();
  } catch {
    return url;
  }
}

export interface HashListingOptions {
  /** Photos (distinct URLs) per call. */
  limit?: number;
  retry?: RetryOptions;
  /** Stop starting new downloads after this time (epoch ms); `more` is then true. */
  until?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * Hashes the photos of Shopify search results attached to products that have a photo hash of
 * their own, newest results first, so `isSamePhoto` can tell the same product sold by another
 * store from a similar one. Each distinct URL is downloaded once and its hash written to every
 * result showing it. A photo that cannot be used is marked `UNUSABLE_PHOTO`.
 */
export async function hashListingPhotos(
  db: AnyDatabase,
  { limit = 30, retry, until, timeoutMs = 15_000, signal }: HashListingOptions = {},
): Promise<{ hashed: number; failed: number; more: boolean }> {
  const latest = max(sourceItems.lastSeenAt);
  const pending = await db
    .select({ url: sourceItems.imageUrl, latest })
    .from(sourceItems)
    .innerJoin(products, eq(products.id, sourceItems.productId))
    .where(
      and(
        eq(sourceItems.provider, SEARCH_LISTING_PROVIDER),
        eq(sourceItems.kind, "store_product"),
        isNull(sourceItems.imageHash),
        isNotNull(sourceItems.imageUrl),
        isNotNull(products.imageHash),
        isNull(products.mergedInto),
      ),
    )
    .groupBy(sourceItems.imageUrl)
    // Newest results first, one product's photos together (its comparison completes sooner).
    .orderBy(desc(latest), sql`min(${sourceItems.productId}::text)`, sourceItems.imageUrl)
    .limit(limit);

  let hashed = 0;
  let failed = 0;
  let stopped = false;
  for (const { url } of pending) {
    signal?.throwIfAborted();
    if (until !== undefined && Date.now() > until) {
      stopped = true;
      break;
    }
    let hash = UNUSABLE_PHOTO;
    if (url && isAllowedImageUrl(url)) {
      try {
        const res = await fetchImage(
          thumbnailUrl(url),
          { signal },
          { retries: 1, timeoutMs, ...retry },
        );
        hash = await dHash(await readCapped(res, MAX_IMAGE_BYTES));
      } catch (err) {
        // The caller's time budget ran out: not this photo's fault, it stays pending.
        if (signal?.aborted) throw err;
      }
    }
    if (hash === UNUSABLE_PHOTO) failed++;
    else hashed++;
    await db
      .update(sourceItems)
      .set({ imageHash: hash })
      .where(
        and(
          eq(sourceItems.imageUrl, url!),
          eq(sourceItems.provider, SEARCH_LISTING_PROVIDER),
          isNull(sourceItems.imageHash),
        ),
      );
  }
  return { hashed, failed, more: stopped || pending.length === limit };
}
