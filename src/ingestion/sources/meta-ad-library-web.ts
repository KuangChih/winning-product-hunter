import { fetchWithRetry, type RetryOptions } from "../http";
import type { FetchContext, FetchedItem, SourceAdapter } from "../types";

/**
 * Public Meta Ad Library website (facebook.com/ads/library), the only source of commercial
 * ads delivered outside the UK/EU (ADR-006). The search page embeds its first page of results
 * as JSON, so a single plain GET per query and country is enough: no browser, no login.
 *
 * Collection rules (ADR-006): honest User-Agent, one request every few seconds, a hard cap per
 * run, and stop immediately when Meta asks for a CAPTCHA, a login or returns no results data.
 */

export const AD_LIBRARY_URL = "https://www.facebook.com/ads/library/";
export const USER_AGENT = "WinningProductHunter/0.1 (personal research)";

export class AdLibraryBlockedError extends Error {
  constructor(reason: string) {
    super(`Meta Ad Library blocked the request: ${reason}`);
    this.name = "AdLibraryBlockedError";
  }
}

interface AdSnapshot {
  page_name?: string;
  title?: string | null;
  body?: { text?: string } | null;
  caption?: string | null;
  cta_type?: string | null;
  display_format?: string | null;
  link_url?: string | null;
  page_like_count?: number | null;
  page_categories?: string[] | null;
}

export interface LibraryAd {
  ad_archive_id: string;
  collation_count?: number | null;
  collation_id?: string | null;
  is_active?: boolean;
  page_id?: string;
  page_name?: string;
  start_date?: number | null;
  end_date?: number | null;
  publisher_platform?: string[] | null;
  snapshot?: AdSnapshot;
}

export interface AdLibrarySearch {
  /** Approximate number of matching ads. */
  count: number;
  ads: LibraryAd[];
  hasNextPage: boolean;
}

export function buildSearchUrl(query: string, country: string): string {
  const params = new URLSearchParams({
    active_status: "active",
    ad_type: "all",
    country,
    q: query,
    search_type: "keyword_unordered",
    media_type: "all",
  });
  return `${AD_LIBRARY_URL}?${params}`;
}

function findKey(value: unknown, key: string): { owner: Record<string, unknown> } | undefined {
  if (!value || typeof value !== "object") return undefined;
  const obj = value as Record<string, unknown>;
  if (key in obj) return { owner: obj };
  for (const child of Object.values(obj)) {
    const found = findKey(child, key);
    if (found) return found;
  }
  return undefined;
}

/** Extracts the embedded search results from the Ad Library search page HTML. */
export function parseAdLibraryHtml(html: string): AdLibrarySearch {
  const scripts = html.matchAll(/<script type="application\/json"[^>]*>([\s\S]*?)<\/script>/g);
  for (const [, text] of scripts) {
    if (!text.includes("search_results_connection")) continue;
    const json: unknown = JSON.parse(text);
    // Meta flags CAPTCHA challenges in the page data; we never try to solve them.
    const captcha = findKey(json, "xfb_ad_library_is_captcha_required");
    if (captcha?.owner.xfb_ad_library_is_captcha_required === true) {
      throw new AdLibraryBlockedError("CAPTCHA required");
    }
    const found = findKey(json, "search_results_connection");
    if (!found) continue;
    const conn = found.owner.search_results_connection as {
      count?: number;
      edges?: Array<{ node?: { collated_results?: LibraryAd[] } }>;
      page_info?: { has_next_page?: boolean };
    };
    return {
      count: conn.count ?? 0,
      ads: (conn.edges ?? []).flatMap((e) => e.node?.collated_results ?? []),
      hasNextPage: conn.page_info?.has_next_page ?? false,
    };
  }
  if (/login|checkpoint/i.test(html.slice(0, 5000))) {
    throw new AdLibraryBlockedError("login or checkpoint page");
  }
  throw new AdLibraryBlockedError("no search results data in page");
}

const FORMATS: Record<string, string> = { VIDEO: "video", IMAGE: "image", DCO: "dynamic" };

export function toFetchedItems(
  search: AdLibrarySearch,
  query: string,
  country: string,
): FetchedItem[] {
  const items: FetchedItem[] = search.ads.map((ad) => {
    const s = ad.snapshot ?? {};
    const metrics: FetchedItem["metrics"] = [];
    if (typeof ad.collation_count === "number") {
      metrics.push({ metric: "creative_variants", value: ad.collation_count });
    }
    if (typeof s.page_like_count === "number") {
      metrics.push({ metric: "page_likes", value: s.page_like_count });
    }
    return {
      externalId: ad.ad_archive_id,
      kind: "ad" as const,
      title: s.title || s.body?.text?.split("\n")[0] || undefined,
      url: `${AD_LIBRARY_URL}?id=${ad.ad_archive_id}`,
      countries: [country],
      advertiserId: ad.page_id,
      advertiserName: ad.page_name ?? s.page_name,
      format: s.display_format
        ? (FORMATS[s.display_format] ?? s.display_format.toLowerCase())
        : undefined,
      startedAt: ad.start_date ? new Date(ad.start_date * 1000) : undefined,
      // end_date is the scheduled end; only stopped ads have actually ended.
      endedAt: ad.is_active === false && ad.end_date ? new Date(ad.end_date * 1000) : null,
      metrics,
      raw: {
        ad_archive_id: ad.ad_archive_id,
        collation_id: ad.collation_id,
        is_active: ad.is_active,
        publisher_platform: ad.publisher_platform,
        landing_url: s.link_url,
        landing_domain: s.caption,
        cta_type: s.cta_type,
        body: s.body?.text,
        page_categories: s.page_categories,
      },
    };
  });
  items.push({
    externalId: `ad-library-results|${query.toLowerCase()}|${country}`,
    kind: "trend",
    title: query,
    countries: [country],
    metrics: [{ metric: "active_ads", value: search.count }],
    raw: { query, country, count: search.count },
  });
  return items;
}

export interface AdLibraryWebOptions {
  countries: string[];
  /** Hard cap on page requests per run (ADR-006). */
  maxRequests?: number;
  /** Pause between requests; keep it slow. */
  wait?: () => Promise<void>;
  retry?: RetryOptions;
}

export function createAdLibraryWebAdapter(opts: AdLibraryWebOptions): SourceAdapter {
  const maxRequests = opts.maxRequests ?? 50;
  return {
    source: "meta_ads",
    provider: "ad_library_web",
    async *fetch(ctx: FetchContext) {
      let requests = 0;
      let emitted = 0;
      for (const query of ctx.queries) {
        for (const country of opts.countries) {
          if (ctx.signal?.aborted || emitted >= ctx.limit || requests >= maxRequests) return;
          await opts.wait?.();
          requests++;
          const res = await fetchWithRetry(
            buildSearchUrl(query, country),
            {
              headers: { "User-Agent": USER_AGENT, "Accept-Language": "en-US,en;q=0.9" },
              signal: ctx.signal,
            },
            // Do not hammer on 429: one retry at most, honoring Retry-After.
            { retries: 1, ...opts.retry },
          );
          // A block ends the whole run (stop and back off); it is recorded in ingestion_runs.
          const search = parseAdLibraryHtml(await res.text());
          for (const item of toFetchedItems(search, query, country)) {
            if (emitted >= ctx.limit) return;
            emitted++;
            yield item;
          }
        }
      }
    },
  };
}
