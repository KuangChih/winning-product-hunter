import { jaccard, titleTokens } from "./normalize";

/** Provider of the catalog search results whose photos are compared (ADR-016). */
export const SEARCH_LISTING_PROVIDER = "shopify_catalog";

/**
 * When two photos (dHash) show the same product (ADR-016). The same rule merges duplicate
 * products (`MERGE_RULES`) and marks Shopify search results that are this very product sold by
 * another store (usually the same supplier photo re-uploaded), as opposed to similar products.
 * Measured on real CJ products vs Shopify search results (docs/research/same-photo-listings.md):
 * same-product listings were at distance 1–8, other products mostly 13 or more.
 */
export const SAME_PHOTO_RULES = {
  /** Near-identical photo: same product even if titles differ (different store names). */
  identicalImage: 2,
  /** Similar photo: same product only if titles also overlap. */
  similarImage: 8,
  minTitleJaccard: 0.25,
};

const BITS_IN_NIBBLE = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];

export function hammingDistance(a: string, b: string): number {
  let count = 0;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    count += BITS_IN_NIBBLE[parseInt(a[i] ?? "0", 16) ^ parseInt(b[i] ?? "0", 16)];
  }
  return count;
}

/** A usable dHash (64 bits as 16 hex chars); failed photos are stored as "-". */
export function isPhotoHash(hash: string | null | undefined): hash is string {
  return typeof hash === "string" && /^[0-9a-f]{16}$/.test(hash);
}

export interface PhotoRef {
  imageHash: string | null | undefined;
  title: string | null | undefined;
}

/** Whether a search result shows the product's own photo; null when it cannot be compared. */
export function samePhotoOf(product: PhotoRef | undefined, item: PhotoRef): boolean | null {
  if (!product || !isPhotoHash(product.imageHash) || !isPhotoHash(item.imageHash)) return null;
  return isSamePhoto(product, item);
}

/** Same product by photo (and, for merely similar photos, title); false without both hashes. */
export function isSamePhoto(a: PhotoRef, b: PhotoRef): boolean {
  if (!isPhotoHash(a.imageHash) || !isPhotoHash(b.imageHash)) return false;
  const distance = hammingDistance(a.imageHash, b.imageHash);
  if (distance <= SAME_PHOTO_RULES.identicalImage) return true;
  return (
    distance <= SAME_PHOTO_RULES.similarImage &&
    jaccard(titleTokens(a.title ?? ""), titleTokens(b.title ?? "")) >=
      SAME_PHOTO_RULES.minTitleJaccard
  );
}
