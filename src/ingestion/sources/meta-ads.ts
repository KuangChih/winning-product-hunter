import { fetchWithRetry, type RetryOptions } from "../http";
import type { FetchContext, FetchedItem, SourceAdapter } from "../types";
import { AD_LIBRARY_URL } from "./meta-ad-library-web";

/**
 * Official Meta Ad Library API (Graph API `/ads_archive`). Ads of any type are only available
 * for delivery in the UK or the EU (in the past year); elsewhere it returns only social issue,
 * election and political ads. Checked against the official docs on 2026-10-11
 * (docs/research/meta-ad-library-api.md):
 * https://developers.facebook.com/docs/graph-api/reference/ads_archive/
 * https://developers.facebook.com/docs/graph-api/reference/archived-ad/
 *
 * The runner's "Meta official API (UK/EU)" step (ADR-015) sends one counted request at a time
 * through `createMetaApiClient`; `createMetaAdsApiAdapter` is the generic adapter.
 */

/** Graph API version shown by the docs on 2026-10-11. */
export const META_GRAPH_VERSION = "v26.0";
export const META_GRAPH_URL = `https://graph.facebook.com/${META_GRAPH_VERSION}/ads_archive`;
/** Provider name of the official API in `source_items` and `ingestion_runs`. */
export const META_API_PROVIDER = "ad_library_api";

/**
 * Countries where ads of every type can be searched: the UK and the EU (not Norway, not the
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

/**
 * The target markets (CLAUDE.md) the API covers: the UK, then Germany, France, Sweden, Belgium
 * and Spain. Norway is a target market but not in the EU, so the API has no ads for it.
 */
export const META_API_TARGET_COUNTRIES = ["GB", "DE", "FR", "SE", "BE", "ES"] as const;

export function isMetaApiCountry(country: string): boolean {
  return (META_API_COUNTRIES as readonly string[]).includes(country);
}

/**
 * External ids of official-API ads are `api|<Library ID>`, so they never overwrite the record of
 * the same ad collected from the Ad Library website (whose external id is the bare Library ID).
 */
export const META_API_ID_PREFIX = "api|";

/** The Ad Library ID behind a Meta ad's external id (web or official API). */
export function metaLibraryId(externalId: string): string {
  return externalId.startsWith(META_API_ID_PREFIX)
    ? externalId.slice(META_API_ID_PREFIX.length)
    : externalId;
}

/**
 * Subset of Meta's ArchivedAd object (Graph API /ads_archive).
 * https://developers.facebook.com/docs/graph-api/reference/archived-ad/
 * Fields that don't apply to an ad are omitted from the JSON entirely.
 */
export interface MetaArchivedAd {
  /** The Library ID of the ad (numeric string). */
  id: string;
  page_id?: string;
  page_name?: string;
  /** When the ad was created (not when it ran). */
  ad_creation_time?: string;
  /** When the advertiser wants the ad to start running (UTC). */
  ad_delivery_start_time?: string;
  /** When the advertiser wants the ad to stop running; blank: runs until stopped. */
  ad_delivery_stop_time?: string;
  /** Carries the access token in its query string: never requested, never stored. */
  ad_snapshot_url?: string;
  ad_creative_bodies?: string[];
  /** Titles in the call-to-action section of each card. */
  ad_creative_link_titles?: string[];
  /** Captions in the call-to-action section of each card (usually the shown domain). */
  ad_creative_link_captions?: string[];
  ad_creative_link_descriptions?: string[];
  publisher_platforms?: string[];
  languages?: string[];
  /** Estimated combined reach in the EU; EU-delivered ads only. */
  eu_total_reach?: number;
  /** Estimated reach by location; documented keys "EU", "BR" and "UK". */
  total_reach_by_location?: Array<{ key: string; value: number }>;
}

export interface MetaAdsArchiveResponse {
  data: MetaArchivedAd[];
  paging?: { cursors?: { after?: string }; next?: string };
}

/** Fields we request from /ads_archive. Kept here so the real client and fixtures agree. */
export const META_AD_FIELDS = [
  "id",
  "page_id",
  "page_name",
  "ad_creation_time",
  "ad_delivery_start_time",
  "ad_delivery_stop_time",
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

const isCount = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

/** UK reach from `total_reach_by_location`, only when an entry has the documented "UK" key. */
export function ukReach(ad: MetaArchivedAd): number | null {
  const list = Array.isArray(ad.total_reach_by_location) ? ad.total_reach_by_location : [];
  const uk = list.find((r) => r && r.key === "UK");
  return uk && isCount(uk.value) ? uk.value : null;
}

/**
 * `requested`: the countries the request asked about (`ad_reached_countries`). With one country
 * the ad reached it. With several, only the UK can be told apart (its reach is reported): the
 * ad gets "GB" when its UK reach is above zero and no country otherwise (the EU reach does not
 * say which EU country), so market reach is never overstated.
 */
export function parseMetaAd(
  ad: MetaArchivedAd,
  requested?: string | readonly string[],
): FetchedItem {
  const asked = typeof requested === "string" ? [requested] : (requested ?? []);
  const metrics: FetchedItem["metrics"] = [];
  if (isCount(ad.eu_total_reach)) {
    metrics.push({ metric: "eu_total_reach", value: ad.eu_total_reach });
  }
  const uk = ukReach(ad);
  if (uk !== null) metrics.push({ metric: "uk_total_reach", value: uk });
  const countries =
    asked.length === 1
      ? [...asked]
      : asked.length > 1 && asked.includes("GB") && (uk ?? 0) > 0
        ? ["GB"]
        : [];
  // The snapshot URL embeds the access token: keep the public Library link instead.
  const { ad_snapshot_url: _snapshot, ...raw } = ad;
  void _snapshot;
  return {
    externalId: `${META_API_ID_PREFIX}${ad.id}`,
    kind: "ad",
    title: ad.ad_creative_link_titles?.[0] ?? ad.ad_creative_bodies?.[0],
    url: `${AD_LIBRARY_URL}?id=${ad.id}`,
    // Ads of every type are only available for UK/EU delivery.
    region: countries.length === 1 && countries[0] === "GB" ? "GB" : "EU",
    ...(requested !== undefined ? { countries } : {}),
    advertiserId: ad.page_id,
    advertiserName: ad.page_name,
    startedAt: parseDate(ad.ad_delivery_start_time ?? ad.ad_creation_time),
    endedAt: parseDate(ad.ad_delivery_stop_time) ?? null,
    metrics,
    raw,
  };
}

export function parseMetaAdsResponse(
  res: MetaAdsArchiveResponse,
  requested?: string | readonly string[],
): FetchedItem[] {
  return res.data.map((ad) => parseMetaAd(ad, requested));
}

export type MetaApiErrorKind = "token" | "rate_limited" | "request" | "service";

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

  /** 613 (and Graph's generic 4, 17, 32): rate limited; stop and try later. */
  get rateLimited() {
    return this.status === 429 || [4, 17, 32, 613].includes(this.code ?? -1);
  }

  /**
   * token: renew the token; rate_limited: stop and back off; request: Meta refused the request
   * itself (every other request would fail the same way); service: Meta or the network failed.
   */
  get kind(): MetaApiErrorKind {
    if (this.tokenInvalid) return "token";
    if (this.rateLimited) return "rate_limited";
    if (this.status >= 400 && this.status < 500) return "request";
    return "service";
  }
}

export interface AdsArchiveRequest {
  /** `ad_reached_countries`: ads that reached any of these. */
  countries: readonly string[];
  /** Keyword search (`search_terms`, at most 100 characters)… */
  query?: string;
  /** …or the ads of these Facebook pages (at most 10). */
  pageIds?: string[];
  after?: string;
  limit?: number;
}

export function buildAdsArchiveUrl(token: string, req: AdsArchiveRequest): string {
  const params = new URLSearchParams({
    ad_reached_countries: JSON.stringify(req.countries),
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

export interface AdsArchivePage {
  items: FetchedItem[];
  /** Cursor of the next page; null on the last page. */
  after: string | null;
}

/**
 * One /ads_archive request. Throws `MetaApiError` (never containing the token or the URL) when
 * Meta refuses it or it cannot be sent; rethrows an abort of `signal`.
 */
export async function fetchAdsArchivePage(
  opts: { token: string; retry?: RetryOptions },
  req: AdsArchiveRequest,
  signal?: AbortSignal,
): Promise<AdsArchivePage> {
  const countries = req.countries.filter(isMetaApiCountry);
  if (countries.length === 0) return { items: [], after: null };
  const url = buildAdsArchiveUrl(opts.token, { ...req, countries });
  const clean = (text: string) => text.replaceAll(opts.token, "[token]").slice(0, 300);
  let res: Response;
  try {
    res = await fetchWithRetry(
      url,
      { signal },
      // Client errors carry Graph's error JSON: read it here (no token in messages).
      { retries: 1, ...opts.retry, acceptStatus: (s) => s >= 400 && s < 500 },
    );
  } catch (err) {
    if (signal?.aborted) throw err;
    const status = (err as { status?: number }).status ?? 0;
    throw new MetaApiError(status, null, status ? "server error" : "network error or timeout");
  }
  const body = (await res.json().catch(() => null)) as
    (MetaAdsArchiveResponse & { error?: { code?: number; message?: string } }) | null;
  if (!res.ok || !body || body.error || !Array.isArray(body.data)) {
    const e = body?.error;
    throw new MetaApiError(
      res.status,
      typeof e?.code === "number" ? e.code : null,
      clean(e?.message ?? "unreadable response"),
    );
  }
  return {
    items: parseMetaAdsResponse(body, countries),
    after: body.paging?.next ? (body.paging.cursors?.after ?? null) : null,
  };
}

/** What the runner uses: one counted request per call (ADR-015). */
export interface MetaApiClient {
  search(
    req: { query: string; countries: readonly string[]; after?: string; limit?: number },
    signal?: AbortSignal,
  ): Promise<AdsArchivePage>;
}

export function createMetaApiClient(opts: { token: string; retry?: RetryOptions }): MetaApiClient {
  return {
    search: (req, signal) => fetchAdsArchivePage(opts, req, signal),
  };
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

/** Generic adapter: one request per query, country and page. */
export function createMetaAdsApiAdapter(opts: MetaAdsApiOptions): SourceAdapter {
  const countries = opts.countries.filter(isMetaApiCountry);
  const maxRequests = opts.maxRequests ?? 20;
  const maxPages = opts.maxPages ?? 1;
  return {
    source: "meta_ads",
    provider: META_API_PROVIDER,
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
            const res = await fetchAdsArchivePage(
              opts,
              {
                countries: [country],
                after,
                ...(opts.mode === "page" ? { pageIds: [query] } : { query }),
              },
              ctx.signal,
            );
            for (const item of res.items) {
              if (emitted >= ctx.limit) return;
              emitted++;
              yield item;
            }
            after = res.after ?? undefined;
            if (!after) break;
          }
        }
      }
    },
  };
}
