import { fetchWithRetry, type RetryOptions } from "../http";
import type { FetchContext, FetchedItem, SourceAdapter } from "../types";
import {
  classifyAdLibraryResponse,
  diagnoseAdLibraryResponse,
  formatFailure,
  isBlockKind,
  type AdLibraryDiagnostic,
  type AdLibraryFailureKind,
  type ResponseFacts,
} from "./meta-ad-library-failure";

/**
 * Public Meta Ad Library website (facebook.com/ads/library), the only source of commercial
 * ads delivered outside the UK/EU (ADR-006). The search page embeds its first page of results
 * as JSON, so a single plain GET per query and country is enough: no browser, no login.
 *
 * Collection rules (ADR-006): honest User-Agent, one request every few seconds, a hard cap per
 * run, and stop immediately when Meta asks for a CAPTCHA, a login, refuses (403/429) or serves a
 * page without the results data (see `meta-ad-library-failure.ts` for the cases).
 */

export const AD_LIBRARY_URL = "https://www.facebook.com/ads/library/";
export const USER_AGENT = "WinningProductHunter/0.1 (personal research)";

/**
 * A Meta Ad Library page that could not be used, with its kind and a privacy-safe diagnostic
 * (status, final URL without query, title, markers; never the page itself).
 */
export class AdLibraryResponseError extends Error {
  constructor(
    readonly kind: AdLibraryFailureKind,
    readonly diagnostic: AdLibraryDiagnostic | null,
  ) {
    super(formatFailure(kind, diagnostic));
    this.name = "AdLibraryResponseError";
  }
}

/** Meta refused us (CAPTCHA, login wall, 403, 429): stop and back off (ADR-006). */
export class AdLibraryBlockedError extends AdLibraryResponseError {
  constructor(kind: AdLibraryFailureKind, diagnostic: AdLibraryDiagnostic | null) {
    super(kind, diagnostic);
    this.name = "AdLibraryBlockedError";
  }
}

export function adLibraryError(
  kind: AdLibraryFailureKind,
  diagnostic: AdLibraryDiagnostic | null,
): AdLibraryResponseError {
  return isBlockKind(kind)
    ? new AdLibraryBlockedError(kind, diagnostic)
    : new AdLibraryResponseError(kind, diagnostic);
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

/**
 * All active ads of one advertiser (Facebook page) in one country: the Ad Library "see all ads
 * from this page" view. It embeds the same results JSON as the keyword search.
 */
export function buildPageUrl(pageId: string, country: string): string {
  const params = new URLSearchParams({
    active_status: "active",
    ad_type: "all",
    country,
    view_all_page_id: pageId,
    search_type: "page",
    media_type: "all",
  });
  return `${AD_LIBRARY_URL}?${params}`;
}

/** An advertiser to follow: `"<pageId>@<country>"`, e.g. `"445474685326237@US"`. */
export function advertiserTarget(pageId: string, country: string): string {
  return `${pageId}@${country}`;
}

function parseAdvertiserTarget(target: string): { pageId: string; country: string } | null {
  const m = /^(\d+)@([A-Z]{2})$/.exec(target);
  return m ? { pageId: m[1], country: m[2] } : null;
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

/**
 * Extracts the embedded search results from the Ad Library search page HTML. A page without
 * usable results throws an `AdLibraryResponseError` saying which case it is (`res`: the HTTP
 * status, final URL and redirect flag, for the diagnostic).
 */
export function parseAdLibraryHtml(html: string, res: ResponseFacts = {}): AdLibrarySearch {
  const fail = (kind?: AdLibraryFailureKind) => {
    const d = diagnoseAdLibraryResponse(html, res);
    return adLibraryError(kind ?? classifyAdLibraryResponse(d), d);
  };
  // An error page (403, 429) is never read as results, whatever it contains.
  if (res.status != null && res.status >= 400) throw fail();
  const scripts = html.matchAll(/<script type="application\/json"[^>]*>([\s\S]*?)<\/script>/g);
  for (const [, text] of scripts) {
    if (!text.includes("search_results_connection")) continue;
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw fail("parse_error");
    }
    // Meta flags CAPTCHA challenges in the page data; we never try to solve them.
    const captcha = findKey(json, "xfb_ad_library_is_captcha_required");
    if (captcha?.owner.xfb_ad_library_is_captcha_required === true) throw fail("captcha");
    const found = findKey(json, "search_results_connection");
    if (!found) continue;
    const conn = found.owner.search_results_connection as {
      count?: number;
      edges?: Array<{ node?: { collated_results?: LibraryAd[] } }>;
      page_info?: { has_next_page?: boolean };
    } | null;
    if (!conn || typeof conn !== "object") throw fail("parse_error");
    return {
      count: conn.count ?? 0,
      ads: (conn.edges ?? []).flatMap((e) => e.node?.collated_results ?? []),
      hasNextPage: conn.page_info?.has_next_page ?? false,
    };
  }
  throw fail();
}

const FORMATS: Record<string, string> = { VIDEO: "video", IMAGE: "image", DCO: "dynamic" };

export function toFetchedItems(
  search: AdLibrarySearch,
  query: string,
  country: string,
  { summary = true }: { summary?: boolean } = {},
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
  // The active-ad count of a keyword search is a demand signal; an advertiser's count is not.
  if (!summary) return items;
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
  /**
   * "keyword": queries are search terms, run in every country (default).
   * "advertiser": queries are `advertiserTarget()` strings; each is one page view.
   */
  mode?: "keyword" | "advertiser";
  countries: string[];
  /** Hard cap on page requests per run (ADR-006). */
  maxRequests?: number;
  /** Pause between requests; keep it slow. */
  wait?: (signal?: AbortSignal) => Promise<void>;
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
      const advertiserMode = opts.mode === "advertiser";
      for (const query of ctx.queries) {
        const target = advertiserMode ? parseAdvertiserTarget(query) : null;
        if (advertiserMode && !target) continue;
        for (const country of target ? [target.country] : opts.countries) {
          if (ctx.signal?.aborted || emitted >= ctx.limit || requests >= maxRequests) return;
          await opts.wait?.(ctx.signal);
          requests++;
          const res = await fetchWithRetry(
            target ? buildPageUrl(target.pageId, country) : buildSearchUrl(query, country),
            {
              headers: { "User-Agent": USER_AGENT, "Accept-Language": "en-US,en;q=0.9" },
              signal: ctx.signal,
            },
            // 403 and 429 come back as pages to diagnose: never retried (stop and back off).
            { retries: 1, ...opts.retry, acceptStatus: (st) => st === 403 || st === 429 },
          );
          // An unusable page ends the whole run (a block also backs off); the diagnostic is
          // recorded in ingestion_runs. Redirects are followed: `res.url` is where we ended up.
          const search = parseAdLibraryHtml(await res.text(), {
            status: res.status,
            url: res.url,
            redirected: res.redirected,
          });
          const items = toFetchedItems(search, query, country, { summary: !target });
          for (const item of items) {
            if (emitted >= ctx.limit) return;
            emitted++;
            yield item;
          }
        }
      }
    },
  };
}
