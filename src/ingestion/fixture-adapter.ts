import type { FetchContext, FetchedItem, Source, SourceAdapter } from "./types";

/**
 * Serves canned items so the pipeline can be developed and tested without API keys.
 * Items are tagged with provider "fixture" and the UI must label them as sample data.
 */
export function createFixtureAdapter(source: Source, items: FetchedItem[]): SourceAdapter {
  return {
    source,
    provider: "fixture",
    async *fetch(ctx: FetchContext) {
      const terms = ctx.queries.map((q) => q.toLowerCase());
      let count = 0;
      for (const item of items) {
        if (count >= ctx.limit || ctx.signal?.aborted) return;
        const title = item.title?.toLowerCase() ?? "";
        if (terms.length > 0 && !terms.some((t) => title.includes(t))) continue;
        count++;
        yield item;
      }
    },
  };
}
