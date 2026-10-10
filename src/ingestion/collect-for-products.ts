import type { FetchContext, SourceAdapter } from "./types";

export interface ProductQuery {
  productId: string;
  query: string;
}

/**
 * Runs a search-style adapter once per product, using the product's title as the query, and
 * tags every result with that product. Search results describe the queried product, but their
 * titles vary too much for title matching, so they are attached directly instead.
 */
export function forProducts(adapter: SourceAdapter, products: ProductQuery[]): SourceAdapter {
  return {
    source: adapter.source,
    provider: adapter.provider,
    async *fetch(ctx: FetchContext) {
      let emitted = 0;
      for (const p of products) {
        if (ctx.signal?.aborted || emitted >= ctx.limit) return;
        const sub = { ...ctx, queries: [p.query], limit: ctx.limit - emitted };
        for await (const item of adapter.fetch(sub)) {
          emitted++;
          yield { ...item, productId: p.productId };
        }
      }
    },
  };
}
