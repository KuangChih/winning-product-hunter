import { fetchWithRetry, type RetryOptions } from "../http";
import type { FetchContext, FetchedItem, SourceAdapter } from "../types";
import { AD_LIBRARY_URL } from "./meta-ad-library-web";

/**
 * Official Meta Ad Library API (Graph API `/ads_archive`). Commercial ads are only available
 * for delivery in the UK or the EU (any ad type delivered there in the past year); elsewhere it
 * returns only social issue, election and political ads. Checked against the official docs on
 * 2026-10-11 (docs/research/meta-ad-library-web.md):
 * https://developers.facebook.com/docs/graph-api/reference/ads_archive/
 * https://developers.facebook.com/docs/graph-api/reference/archived-ad/
 *
 * Not wired into the pipeline runner yet: the API has no landing page URL field, and discovery
 * groups ads into products by landing page (see the research note).
 */

/** Graph API version shown by the docs on 2026-10-11. */
export const META_GRAPH_VERSION = "v26.0";
export const META_GRAPH_URL = `https://graph.facebook.com/${META_GRAPH_VERSION}/ads_archive`;

/**
 * Countries where commercial ads can be searched: the UK and the EU (not Norway, not the
 * other English-speaking markets).
 */
export const META_API_COUNTRIES = [
  "GB",
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "HU",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE",
] as const;

export function isMetaApiCountry(country: string): boolean {
  return (META_API_COUNTRIES as readonly string[]).includes(country);
}

/**
 * Subset of Meta's ArchivedAd object (Graph API /ads_archive).
 * https://developers.facebook.com/docs/graph-api/reference/archived-ad/
 * Fields that don't apply to an ad are omitted from the JSON entirely.
 */
export interface MetaArchivedAd {
  id: string;
  page_id?: string;
  page_name?: string;
  ad_creation_time?: string;
  ad_delivery_start_time?: string;
  ad_delivery_stop_time?: string;
  /** Carries the access token in its query string: never stored. */
  ad_snapshot_url?: string;
  ad_creative_bodies?: string[];
  ad_creative_link_titles?: string[];
  ad_creative_link_captions?: string[];
  ad_creative_link_descriptions?: string[];
  publisher_platforms?: string[];
  languages?: string[];
  /** EU-delivered ads only. */
  eu_total_reach?: number;
  /** Estimated reach by location (EU, UK, BR). */
  total_reach_by_location?: Array<{ key: string; value: number }>;
}

export interface MetaAdsArchiveResponse {
  data: MetaArchivedAd[];
  paging?: { cursors?: { after?: string }; next?: string };
}

/** Fields we request from /ads_archive. Kept here so the real adapter and fixtures agree. */
export const META_AD_FIELDS = [
  "id",
  "page_id",
  "page_name",
  "ad_creation_time",
  "ad_delivery_start_time",
  "ad_delivery_stop_time",
  "ad_snapshot_url",
  "ad_creative_bodies",
  "ad_creative_link_titles",
  "ad_creative_link_captions",
  "ad_creative_link_descriptions",
  "publisher_platforms",
  "languages",
  "eu_total_reach",
  "total_reach_by_location",
] as const;

function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** `country`: the one country the request asked about (the ad reached it). */
export function parseMetaAd(ad: MetaArchivedAd, country?: string): FetchedItem {
  const metrics: FetchedItem["metrics"] = [];
  if (typeof ad.eu_total_reach === "number") {
    metrics.push({ metric: "eu_total_reach", value: ad.eu_total_reach });
  }
  const ukReach = ad.total_reach_by_location?.find((r) => r.key === "UK" || r.key === "GB");
  if (typeof ukReach?.value === "number") {
    metrics.push({ metric: "uk_total_reach", value: ukReach.value });
  }
  // The snapshot URL embeds our access token: keep the public Library link instead.
  const { ad_snapshot_url: _snapshot, ...raw } = ad;
  void _snapshot;
  return {
    externalId: ad.id,
    kind: "ad",
    title: ad.ad_creative_link_titles?.[0] ?? ad.ad_creative_bodies?.[0],
    url: `${AD_LIBRARY_URL}?id=${ad.id}`,
    // Commercial ads are only available for UK/EU delivery.
    region: country === "GB" ? "GB" : "EU",
    ...(country ? { countries: [country] } : {}),
    advertiserId: ad.page_id,
    advertiserName: ad.page_name,
    startedAt: parseDate(ad.ad_delivery_start_time ?? ad.ad_creation_time),
    endedAt: parseDate(ad.ad_delivery_stop_time) ?? null,
    metrics,
    raw,
  };
}

export function parseMetaAdsResponse(res: MetaAdsArchiveResponse, country?: string): FetchedItem[] {
  return res.data.map((ad) => parseMetaAd(ad, country));
}

/** A Graph API error, without the request URL (it carries the access token). */
export class MetaApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: number | null,
    detail: string,
  ) {
    super(`Meta Ad Library API HTTP ${status}${code === null ? "" : ` (code ${code})`}: ${detail}`);
    this.name = "MetaApiError";
  }

  /** 190: the token is invalid or expired; the user must renew it. */
  get tokenInvalid() {
    return this.code === 190;
  }

  /** 613 (and the generic 4, 17, 32): rate limited; stop and try later. */
  get rateLimited() {
    return this.status === 429 || [4, 17, 32, 613].includes(this.code ?? -1);
  }
}

export interface AdsArchiveRequest {
  country: string;
  /** Keyword search (`search_terms`, at most 100 characters)… */
  query?: string;
  /** …or the ads of these Facebook pages (at most 10). */
  pageIds?: string[];
  after?: string;
  limit?: number;
}

export function buildAdsArchiveUrl(token: string, req: AdsArchiveRequest): string {
  const params = new URLSearchParams({
    ad_reached_countries: JSON.stringify([req.country]),
    ad_type: "ALL",
    ad_active_status: "ACTIVE",
    fields: META_AD_FIELDS.join(","),
    limit: String(req.limit ?? 100),
    access_token: token,
  });
  if (req.query) {
    params.set("search_terms", req.query.slice(0, 100));
    params.set("search_type", "KEYWORD_UNORDERED");
  }
  if (req.pageIds?.length) params.set("search_page_ids", JSON.stringify(req.pageIds.slice(0, 10)));
  if (req.after) params.set("after", req.after);
  return `${META_GRAPH_URL}?${params}`;
}

export interface MetaAdsApiOptions {
  token: string;
  /** Only UK/EU countries are queried (others have no commercial ads in the API). */
  countries: string[];
  /** "keyword": queries are search terms; "page": queries are Facebook page IDs. */
  mode?: "keyword" | "page";
  /** Hard cap on API calls per run. */
  maxRequests?: number;
  /** Pages of results per query and country. */
  maxPages?: number;
  retry?: RetryOptions;
}

export function createMetaAdsApiAdapter(opts: MetaAdsApiOptions): SourceAdapter {
  const countries = opts.countries.filter(isMetaApiCountry);
  const maxRequests = opts.maxRequests ?? 20;
  const maxPages = opts.maxPages ?? 1;
  return {
    source: "meta_ads",
    provider: "ad_library_api",
    async *fetch(ctx: FetchContext) {
      let requests = 0;
      let emitted = 0;
      for (const query of ctx.queries) {
        if (opts.mode === "page" && !/^\d+$/.test(query)) continue;
        for (const country of countries) {
          let after: string | undefined;
          for (let page = 0; page < maxPages; page++) {
            if (ctx.signal?.aborted || emitted >= ctx.limit || requests >= maxRequests) return;
            requests++;
            const url = buildAdsArchiveUrl(opts.token, {
              country,
              after,
              ...(opts.mode === "page" ? { pageIds: [query] } : { query }),
            });
            let res: Response;
            try {
              res = await fetchWithRetry(
                url,
                { signal: ctx.signal },
                // Client errors carry Graph's error JSON: read it here (no token in messages).
                { retries: 1, ...opts.retry, acceptStatus: (s) => s >= 400 && s < 500 },
              );
            } catch (err) {
              if (ctx.signal?.aborted) throw err;
              const status = (err as { status?: number }).status ?? 0;
              throw new MetaApiError(status, null, status ? "server error" : "network error");
            }
            const body = (await res.json().catch(() => null)) as
              (MetaAdsArchiveResponse & { error?: { code?: number; message?: string } }) | null;
            if (!res.ok || !body || body.error) {
              const e = body?.error;
              throw new MetaApiError(
                res.status,
                e?.code ?? null,
                (e?.message ?? "unreadable response")
                  .replaceAll(opts.token, "[token]")
                  .slice(0, 300),
              );
            }
            for (const item of parseMetaAdsResponse(body, country)) {
              if (emitted >= ctx.limit) return;
              emitted++;
              yield item;
            }
            after = body.paging?.next ? body.paging.cursors?.after : undefined;
            if (!after) break;
          }
        }
      }
    },
  };
}
