import {
  and,
  eq,
  exists,
  inArray,
  isNotNull,
  isNull,
  not,
  notExists,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { AnyDatabase } from "@/db/client";
import { collectionAttempts, products, sourceItems, watchlist } from "@/db/schema";
import { landingKey } from "@/discovery/landing";
import { OWN_LISTING_PROVIDER } from "@/lib/retail-price";

export interface AdAttachmentRepair {
  /** Ad Library ads attached to a product whose page they do not link to. */
  mismatched: number;
  /** …of which link to another tracked product's page and move there. */
  moved: number;
  /** …of which link to no tracked product and are dropped (re-collectable public data). */
  dropped: number;
  /** Products left without any evidence (and not watched), removed with their stale scores. */
  emptiedProducts: number;
  /** Products whose ads changed, so their scores need recomputing. */
  affectedProducts: number;
}

/**
 * Repairs Ad Library ads that keyword searches attached to the wrong product (every advertiser
 * using similar words was attached to the queried product). An ad is evidence for a product only
 * if it links to that product's own page. Dry run unless `apply` is set.
 */
export async function repairAdAttachments(
  db: AnyDatabase,
  { apply = false }: { apply?: boolean } = {},
): Promise<AdAttachmentRepair> {
  const ads = await db
    .select({
      id: sourceItems.id,
      raw: sourceItems.raw,
      productId: sourceItems.productId,
      productKey: products.landingKey,
    })
    .from(sourceItems)
    .innerJoin(products, eq(sourceItems.productId, products.id))
    .where(
      and(
        eq(sourceItems.kind, "ad"),
        eq(sourceItems.provider, "ad_library_web"),
        isNotNull(sourceItems.productId),
      ),
    );

  const keyed = await db
    .select({ id: products.id, landingKey: products.landingKey, mergedInto: products.mergedInto })
    .from(products)
    .where(isNotNull(products.landingKey));
  const productByKey = new Map(keyed.map((p) => [p.landingKey!, p.mergedInto ?? p.id]));

  const moves = new Map<string, string[]>();
  const drops: string[] = [];
  const affected = new Set<string>();
  for (const ad of ads) {
    const key = landingKey((ad.raw as { landing_url?: string } | null)?.landing_url)?.key;
    if (ad.productKey && key === ad.productKey) continue;
    affected.add(ad.productId!);
    const target = key ? productByKey.get(key) : undefined;
    if (target && target !== ad.productId) {
      moves.set(target, [...(moves.get(target) ?? []), ad.id]);
      affected.add(target);
    } else {
      drops.push(ad.id);
    }
  }
  const moved = [...moves.values()].reduce((n, ids) => n + ids.length, 0);

  let emptiedProducts = 0;
  if (apply) {
    for (const [target, ids] of moves) {
      await db.update(sourceItems).set({ productId: target }).where(inArray(sourceItems.id, ids));
    }
    for (let i = 0; i < drops.length; i += 500) {
      await db.delete(sourceItems).where(inArray(sourceItems.id, drops.slice(i, i + 500)));
    }
    if (affected.size > 0) {
      const emptied = await db
        .delete(products)
        .where(
          and(
            inArray(products.id, [...affected]),
            isNull(products.mergedInto),
            notExists(
              db
                .select({ one: sql`1` })
                .from(sourceItems)
                .where(eq(sourceItems.productId, products.id)),
            ),
            notExists(
              db
                .select({ one: sql`1` })
                .from(watchlist)
                .where(eq(watchlist.productId, products.id)),
            ),
          ),
        )
        .returning({ id: products.id });
      emptiedProducts = emptied.length;
    }
  }

  return {
    mismatched: moved + drops.length,
    moved,
    dropped: drops.length,
    emptiedProducts,
    affectedProducts: affected.size,
  };
}

/** Provider of Shopify search results (similar products from other stores). */
const SHOPIFY_SEARCH_PROVIDER = "shopify_catalog";

export interface ProductImageRepair {
  /**
   * Active discovered, non-sample products showing a Shopify search result's photo that is not
   * also their own listing's or an ad's.
   */
  wrongImages: number;
  /** …of which have an own-listing photo, used the next time photos are hashed. */
  withOwnListingPhoto: number;
  /** Products earlier merged into an affected product on the strength of its photo. */
  mergedIntoAffected: number;
  /** Products reset (apply only). */
  reset: number;
}

/**
 * Finds products whose photo came from a Shopify search result (a similar product from another
 * store) instead of the advertiser's own listing or an ad. Applying clears the photo and its
 * hash so the next dedupe hashes the right photo (or none). Earlier merges are not undone.
 * Dry run unless `apply` is set.
 */
export async function repairProductImages(
  db: AnyDatabase,
  { apply = false }: { apply?: boolean } = {},
): Promise<ProductImageRepair> {
  const hasItem = (...match: SQL[]) =>
    exists(
      db
        .select({ one: sql`1` })
        .from(sourceItems)
        .where(and(eq(sourceItems.productId, products.id), ...match)),
    );
  const own = or(eq(sourceItems.provider, OWN_LISTING_PROVIDER), eq(sourceItems.kind, "ad"))!;
  const samePhoto = eq(sourceItems.imageUrl, products.imageUrl);
  const affected = await db
    .select({ id: products.id, hasOwn: hasItem(own, isNotNull(sourceItems.imageUrl)) })
    .from(products)
    .where(
      and(
        isNull(products.mergedInto),
        isNotNull(products.imageUrl),
        // Only discovered products: a product created by matching shows its seed item's photo,
        // which may be a Shopify search result and is its real photo.
        isNotNull(products.landingKey),
        hasItem(eq(sourceItems.provider, SHOPIFY_SEARCH_PROVIDER), samePhoto),
        not(hasItem(own, samePhoto)),
        not(hasItem(eq(sourceItems.provider, "fixture"))),
      ),
    );
  const ids = affected.map((p) => p.id);
  const merged = ids.length
    ? await db.select({ id: products.id }).from(products).where(inArray(products.mergedInto, ids))
    : [];

  let reset = 0;
  if (apply && ids.length > 0) {
    reset = (
      await db
        .update(products)
        .set({ imageUrl: null, imageHash: null })
        .where(inArray(products.id, ids))
        .returning({ id: products.id })
    ).length;
    await db
      .delete(collectionAttempts)
      .where(
        and(
          eq(collectionAttempts.provider, "image_hash"),
          inArray(collectionAttempts.productId, ids),
        ),
      );
  }
  return {
    wrongImages: ids.length,
    withOwnListingPhoto: affected.filter((p) => p.hasOwn).length,
    mergedIntoAffected: merged.length,
    reset,
  };
}
