import type { FetchedItem } from "../types";

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
  ad_snapshot_url?: string;
  ad_creative_bodies?: string[];
  ad_creative_link_titles?: string[];
  ad_creative_link_captions?: string[];
  publisher_platforms?: string[];
  languages?: string[];
  eu_total_reach?: number;
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
  "publisher_platforms",
  "languages",
  "eu_total_reach",
] as const;

function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export function parseMetaAd(ad: MetaArchivedAd): FetchedItem {
  const metrics: FetchedItem["metrics"] = [];
  if (typeof ad.eu_total_reach === "number") {
    metrics.push({ metric: "eu_total_reach", value: ad.eu_total_reach });
  }
  return {
    externalId: ad.id,
    kind: "ad",
    title: ad.ad_creative_link_titles?.[0] ?? ad.ad_creative_bodies?.[0],
    url: ad.ad_snapshot_url,
    // Commercial ads are only available for EU/UK delivery (ADR-001).
    region: "EU",
    advertiserId: ad.page_id,
    advertiserName: ad.page_name,
    startedAt: parseDate(ad.ad_delivery_start_time ?? ad.ad_creation_time),
    endedAt: parseDate(ad.ad_delivery_stop_time) ?? null,
    metrics,
    raw: ad,
  };
}

export function parseMetaAdsResponse(res: MetaAdsArchiveResponse): FetchedItem[] {
  return res.data.map(parseMetaAd);
}
