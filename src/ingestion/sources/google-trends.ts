import type { FetchedItem } from "../types";

/** SerpApi `engine=google_trends`, `data_type=TIMESERIES` response (subset). */
export interface SerpApiTrendsResponse {
  search_parameters: { q: string; geo?: string; date?: string };
  interest_over_time?: {
    timeline_data: Array<{
      date: string;
      timestamp: string;
      partial_data?: boolean;
      values: Array<{ query: string; value: string; extracted_value: number }>;
    }>;
  };
}

/**
 * One source item per query term, holding the whole interest-over-time series as snapshots
 * dated by each point's timestamp. Partial (still-in-progress) periods are skipped because
 * they understate interest and would fake a downturn.
 */
export function parseSerpApiTrends(res: SerpApiTrendsResponse): FetchedItem[] {
  const geo = res.search_parameters.geo || "WORLDWIDE";
  const points = res.interest_over_time?.timeline_data ?? [];
  const byQuery = new Map<string, FetchedItem>();

  for (const point of points) {
    if (point.partial_data) continue;
    const observedAt = new Date(Number(point.timestamp) * 1000);
    for (const v of point.values) {
      let item = byQuery.get(v.query);
      if (!item) {
        item = {
          externalId: `${v.query.toLowerCase()}|${geo}`,
          kind: "trend",
          title: v.query,
          region: geo === "WORLDWIDE" ? undefined : geo,
          url: `https://trends.google.com/trends/explore?q=${encodeURIComponent(v.query)}${
            geo === "WORLDWIDE" ? "" : `&geo=${geo}`
          }`,
          metrics: [],
          raw: { search_parameters: res.search_parameters },
        };
        byQuery.set(v.query, item);
      }
      item.metrics.push({ metric: "search_interest", value: v.extracted_value, observedAt });
    }
  }
  return [...byQuery.values()];
}
