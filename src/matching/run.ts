import { and, inArray, isNull, ne, or } from "drizzle-orm";
import type { AnyDatabase } from "@/db/client";
import { products, sourceItems } from "@/db/schema";
import { planMatches } from "./plan";

export interface MatchResult {
  productsCreated: number;
  itemsMatched: number;
  itemsUnmatched: number;
}

/** Assigns every source item without a product, creating products where needed. */
export async function runMatching(db: AnyDatabase): Promise<MatchResult> {
  const existing = await db
    .select({ id: products.id, slug: products.slug, title: products.title })
    .from(products)
    .where(isNull(products.mergedInto));
  const items = await db
    .select({
      id: sourceItems.id,
      kind: sourceItems.kind,
      title: sourceItems.title,
      imageUrl: sourceItems.imageUrl,
      firstSeenAt: sourceItems.firstSeenAt,
    })
    .from(sourceItems)
    .where(
      and(
        isNull(sourceItems.productId),
        // Ad Library ads belong to the product whose page they link to (set at discovery);
        // matching them by ad copy would merge different stores' products sharing a phrase.
        or(ne(sourceItems.provider, "ad_library_web"), ne(sourceItems.kind, "ad")),
      ),
    );

  const plan = planMatches(existing, items);

  const createdIds = new Map<string, string>();
  if (plan.newProducts.length > 0) {
    const inserted = await db
      .insert(products)
      .values(
        plan.newProducts.map((p) => ({
          slug: p.slug,
          title: p.title,
          imageUrl: p.imageUrl,
          firstSeenAt: p.firstSeenAt,
        })),
      )
      .returning({ id: products.id, slug: products.slug });
    const idBySlug = new Map(inserted.map((r) => [r.slug, r.id]));
    for (const p of plan.newProducts) createdIds.set(p.key, idBySlug.get(p.slug)!);
  }

  // Group item ids by target product so each product needs one UPDATE.
  const byProduct = new Map<string, string[]>();
  for (const a of plan.assignments) {
    const productId =
      "existing" in a.productRef ? a.productRef.existing : createdIds.get(a.productRef.created)!;
    byProduct.set(productId, [...(byProduct.get(productId) ?? []), a.itemId]);
  }
  for (const [productId, itemIds] of byProduct) {
    await db.update(sourceItems).set({ productId }).where(inArray(sourceItems.id, itemIds));
  }

  return {
    productsCreated: plan.newProducts.length,
    itemsMatched: plan.assignments.length,
    itemsUnmatched: plan.unmatched.length,
  };
}
