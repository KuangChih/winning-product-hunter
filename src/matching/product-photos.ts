import { and, inArray, isNotNull } from "drizzle-orm";
import type { AnyDatabase } from "@/db/client";
import { productPhotos } from "@/db/schema";
import { isPhotoHash } from "./same-photo";

/** Usable extra photo hashes per product (ADR-019), for `isSamePhoto`. */
export async function extraPhotoHashes(
  db: AnyDatabase,
  productIds?: string[],
): Promise<Map<string, string[]>> {
  const rows = await db
    .select({ productId: productPhotos.productId, hash: productPhotos.hash })
    .from(productPhotos)
    .where(
      productIds
        ? and(isNotNull(productPhotos.hash), inArray(productPhotos.productId, productIds))
        : isNotNull(productPhotos.hash),
    );
  const out = new Map<string, string[]>();
  for (const r of rows) {
    if (!isPhotoHash(r.hash)) continue;
    out.set(r.productId, [...(out.get(r.productId) ?? []), r.hash]);
  }
  return out;
}
