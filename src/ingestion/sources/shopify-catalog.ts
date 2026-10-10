import { fetchWithRetry, type RetryOptions } from "../http";
import type { FetchContext, FetchedItem, SourceAdapter } from "../types";

/**
 * Shopify Global Catalog (official MCP, https://shopify.dev/docs/agents/catalog/global-catalog).
 * Cross-store product search: retail prices, selling stores and ratings per ship-to country
 * (ADR-005). No API key; every request carries a UCP agent profile URL.
 */

export const SHOPIFY_CATALOG_ENDPOINT = "https://catalog.shopify.com/api/ucp/mcp";

/**
 * Shopify's published example profile. Replace with our own hosted profile once the site is
 * deployed (set SHOPIFY_UCP_AGENT_PROFILE); see docs/loop/HUMAN_TODO.md.
 */
export const DEFAULT_AGENT_PROFILE =
  "https://shopify.dev/ucp/agent-profiles/examples/2026-08-25/valid-with-capabilities.json";

interface Money {
  amount: number;
  currency: string;
}

export interface CatalogProduct {
  id: string;
  title: string;
  url?: string;
  media?: Array<{ type: string; url: string }>;
  rating?: { value: number; scale_max: number; count: number };
  price_range?: { min: Money; max: Money };
  variants?: Array<{
    id: string;
    url?: string;
    price?: Money;
    availability?: { available?: boolean };
    seller?: { id?: string; name?: string; url?: string; domain?: string };
  }>;
}

export interface CatalogSearchResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: {
    structuredContent?: {
      products?: CatalogProduct[];
      pagination?: { has_next_page?: boolean; total_count?: number; cursor?: string };
    };
    isError?: boolean;
  };
  error?: { code: number; message: string };
}

export class ShopifyCatalogError extends Error {
  constructor(message: string) {
    super(`Shopify Catalog error: ${message}`);
    this.name = "ShopifyCatalogError";
  }
}

export function buildSearchRequest(opts: {
  query: string;
  country: string;
  limit: number;
  profile: string;
  cursor?: string;
}) {
  return {
    jsonrpc: "2.0" as const,
    id: 1,
    method: "tools/call",
    params: {
      name: "search_catalog",
      arguments: {
        meta: { "ucp-agent": { profile: opts.profile } },
        catalog: {
          query: opts.query,
          filters: { ships_to: { country: opts.country }, available: true },
          context: { address_country: opts.country },
          pagination: { limit: opts.limit, ...(opts.cursor ? { cursor: opts.cursor } : {}) },
        },
      },
    },
  };
}

/**
 * Parses one search page for one ship-to country. Each product becomes a `store_product` item
 * (per country, so prices in local currency stay separate), plus one keyword-level item whose
 * metric is how many catalog products match, a supply / saturation signal.
 */
export function parseCatalogSearch(
  res: CatalogSearchResponse,
  query: string,
  country: string,
): FetchedItem[] {
  if (res.error) throw new ShopifyCatalogError(res.error.message);
  if (res.result?.isError) throw new ShopifyCatalogError("tool returned an error");
  const content = res.result?.structuredContent;
  if (!content) throw new ShopifyCatalogError("missing structuredContent");

  const items: FetchedItem[] = (content.products ?? []).map((p) => {
    const variants = p.variants ?? [];
    const sellers = new Set(variants.map((v) => v.seller?.domain).filter(Boolean));
    const firstSeller = variants.find((v) => v.seller)?.seller;
    const metrics: FetchedItem["metrics"] = [{ metric: "selling_stores", value: sellers.size }];
    if (p.rating) {
      metrics.push({ metric: "rating", value: p.rating.value });
      metrics.push({ metric: "rating_count", value: p.rating.count });
    }
    return {
      externalId: `${p.id}|${country}`,
      kind: "store_product" as const,
      title: p.title,
      url: p.url ?? variants[0]?.url,
      imageUrl: p.media?.find((m) => m.type === "image")?.url,
      countries: [country],
      advertiserId: firstSeller?.domain,
      advertiserName: firstSeller?.name,
      priceCents: p.price_range?.min.amount,
      currency: p.price_range?.min.currency,
      metrics,
      raw: p,
    };
  });

  const total = content.pagination?.total_count;
  if (typeof total === "number") {
    items.push({
      externalId: `catalog-results|${query.toLowerCase()}|${country}`,
      kind: "trend",
      title: query,
      countries: [country],
      metrics: [{ metric: "catalog_results", value: total }],
      raw: { query, country, pagination: content.pagination },
    });
  }
  return items;
}

export interface ShopifyCatalogOptions {
  /** Ship-to countries to search, e.g. the tier 1 markets. */
  countries: string[];
  /** Products per query and country (max 50 per page). */
  perQuery?: number;
  profile?: string;
  /** Pause between requests, to stay well within any fair-use limit. */
  wait?: () => Promise<void>;
  retry?: RetryOptions;
}

export function createShopifyCatalogAdapter(opts: ShopifyCatalogOptions): SourceAdapter {
  const profile = opts.profile ?? DEFAULT_AGENT_PROFILE;
  const perQuery = Math.min(opts.perQuery ?? 20, 50);
  return {
    source: "shopify",
    provider: "shopify_catalog",
    async *fetch(ctx: FetchContext) {
      let emitted = 0;
      for (const query of ctx.queries) {
        for (const country of opts.countries) {
          if (ctx.signal?.aborted || emitted >= ctx.limit) return;
          await opts.wait?.();
          const res = await fetchWithRetry(
            SHOPIFY_CATALOG_ENDPOINT,
            {
              method: "POST",
              headers: { "Content-Type": "application/json", Accept: "application/json" },
              body: JSON.stringify(
                buildSearchRequest({ query, country, limit: perQuery, profile }),
              ),
              signal: ctx.signal,
            },
            opts.retry,
          );
          for (const item of parseCatalogSearch(await res.json(), query, country)) {
            if (emitted >= ctx.limit) return;
            emitted++;
            yield item;
          }
        }
      }
    },
  };
}
