import type { FetchContext, FetchedItem, SourceAdapter } from "./types";

export interface ProductQuery {
  productId: string;
  /** One search query, or several (e.g. landing page URLs) for lookup-style adapters. */
  query: string | string[];
  /** The product's landing-page identity (`handle:…`), when it was discovered from ads. */
  landingKey?: string | null;
}

/**
 * Runs a search-style adapter once per product, using the product's title as the query, and
 * tags every result with that product. Search results describe the queried product, but their
 * titles vary too much for title matching, so they are attached directly instead.
 */
export function forProducts(
  adapter: SourceAdapter,
  products: ProductQuery[],
  /** Drops results that are not about this product (e.g. other stores' ads for a keyword). */
  keep: (item: FetchedItem, product: ProductQuery) => boolean = () => true,
): SourceAdapter {
  return {
    source: adapter.source,
    provider: adapter.provider,
    async *fetch(ctx: FetchContext) {
      let emitted = 0;
      for (const p of products) {
        if (ctx.signal?.aborted || emitted >= ctx.limit) return;
        const queries = Array.isArray(p.query) ? p.query : [p.query];
        const sub = { ...ctx, queries, limit: ctx.limit - emitted };
        for await (const item of adapter.fetch(sub)) {
          if (!keep(item, p)) continue;
          emitted++;
          yield { ...item, productId: p.productId };
        }
      }
    },
  };
}
