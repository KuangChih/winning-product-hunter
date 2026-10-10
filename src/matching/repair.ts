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
import { ATTEMPT_FRESH_DAYS } from "@/pipeline/targets";

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

export interface StoreListingRepair {
  /**
   * Active, non-sample products whose advertiser listing was looked up (or whose ads link to a
   * page) but is now stored only as a Shopify search row: their own listing was overwritten.
   */
  affected: number;
  /** …of which have no own-listing row left at all (their advertiser price is gone). */
  withoutOwnListing: number;
  /**
   * …of which still have a fresh own-listing row for another page: clearing attempts does not
   * make them due, they are looked up again once that row is older than the freshness window.
   */
  stillFresh: number;
  /** Lookup attempts cleared (apply only). */
  attemptsCleared: number;
}

/**
 * Finds products whose advertiser listing (ADR-012 price) was overwritten by a Shopify search
 * result. Before lookups had their own external id namespace (`lookup|…`), a search returning
 * the advertiser's product reused the lookup row's id and replaced it with a search row.
 *
 * Rule (conservative; it only re-enables a lookup, it never deletes or edits evidence): a
 * product is affected when one of its ads links to a page (same store and product handle) that is stored
 * as a Shopify search row (attached to any product) while the product has no own-listing row
 * for that page. That is exactly what an overwrite leaves behind; a search that found the
 * advertiser's page without an earlier lookup matches too, and a lookup for it is still the
 * right next step. Applying clears the product's lookup attempts so the next pipeline run
 * queries it again. Dry run unless `apply` is set.
 */
export async function repairStoreListings(
  db: AnyDatabase,
  { apply = false, now = new Date() }: { apply?: boolean; now?: Date } = {},
): Promise<StoreListingRepair> {
  const landingUrl = sql<string | null>`${sourceItems.raw}->>'landing_url'`;
  const [ads, listings, active, samples] = await Promise.all([
    db
      .select({ productId: sourceItems.productId, url: landingUrl })
      .from(sourceItems)
      .where(
        and(
          eq(sourceItems.kind, "ad"),
          isNotNull(sourceItems.productId),
          sql`${landingUrl} is not null`,
        ),
      ),
    db
      .select({
        productId: sourceItems.productId,
        provider: sourceItems.provider,
        url: sourceItems.url,
        lastSeenAt: sourceItems.lastSeenAt,
      })
      .from(sourceItems)
      .where(
        and(
          eq(sourceItems.kind, "store_product"),
          inArray(sourceItems.provider, [SHOPIFY_SEARCH_PROVIDER, OWN_LISTING_PROVIDER]),
        ),
      ),
    db.select({ id: products.id }).from(products).where(isNull(products.mergedInto)),
    db
      .selectDistinct({ productId: sourceItems.productId })
      .from(sourceItems)
      .where(and(eq(sourceItems.provider, "fixture"), isNotNull(sourceItems.productId))),
  ]);
  // Same store and same product page (a collection or locale prefix in the path still matches).
  const pageOf = (url: string | null) => {
    const k = landingKey(url);
    return k ? `${k.host} ${k.key}` : undefined;
  };
  const activeIds = new Set(active.map((p) => p.id));
  const sampleIds = new Set(samples.map((s) => s.productId));

  const searchPages = new Set<string>();
  const ownPages = new Map<string, Set<string>>();
  const freshSince = now.getTime() - ATTEMPT_FRESH_DAYS * 86_400_000;
  const fresh = new Set<string>();
  const hasOwn = new Set<string>();
  for (const l of listings) {
    const page = pageOf(l.url);
    if (l.provider === SHOPIFY_SEARCH_PROVIDER) {
      if (page) searchPages.add(page);
      continue;
    }
    if (!l.productId) continue;
    hasOwn.add(l.productId);
    if (page) ownPages.set(l.productId, (ownPages.get(l.productId) ?? new Set()).add(page));
    if (l.lastSeenAt.getTime() >= freshSince) fresh.add(l.productId);
  }

  const affected = new Set<string>();
  for (const ad of ads) {
    const id = ad.productId!;
    if (!activeIds.has(id) || sampleIds.has(id) || affected.has(id)) continue;
    const page = pageOf(ad.url);
    if (page && searchPages.has(page) && !ownPages.get(id)?.has(page)) affected.add(id);
  }
  const ids = [...affected];

  let attemptsCleared = 0;
  if (apply && ids.length > 0) {
    for (let i = 0; i < ids.length; i += 500) {
      attemptsCleared += (
        await db
          .delete(collectionAttempts)
          .where(
            and(
              eq(collectionAttempts.provider, OWN_LISTING_PROVIDER),
              inArray(collectionAttempts.productId, ids.slice(i, i + 500)),
            ),
          )
          .returning({ id: collectionAttempts.productId })
      ).length;
    }
  }
  return {
    affected: ids.length,
    withoutOwnListing: ids.filter((id) => !hasOwn.has(id)).length,
    stillFresh: ids.filter((id) => fresh.has(id)).length,
    attemptsCleared,
  };
}

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
