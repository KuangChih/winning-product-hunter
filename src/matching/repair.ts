import { and, eq, inArray, isNotNull, isNull, notExists, sql } from "drizzle-orm";
import type { AnyDatabase } from "@/db/client";
import { products, sourceItems, watchlist } from "@/db/schema";
import { landingKey } from "@/discovery/landing";

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
