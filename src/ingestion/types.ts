import type { sourceEnum, sourceItemKindEnum } from "@/db/schema";

export type Source = (typeof sourceEnum.enumValues)[number];
export type SourceItemKind = (typeof sourceItemKindEnum.enumValues)[number];

/** A metric value observed on a source item at fetch time (views, likes, orders, reach...). */
export interface ObservedMetric {
  metric: string;
  value: number;
  /** When the value applies; defaults to fetch time. Set for historical series (e.g. trends). */
  observedAt?: Date;
}

/** A normalized observation produced by an adapter, ready to be stored as a source item. */
export interface FetchedItem {
  externalId: string;
  kind: SourceItemKind;
  title?: string;
  url?: string;
  imageUrl?: string;
  region?: string;
  advertiserId?: string;
  advertiserName?: string;
  format?: string;
  startedAt?: Date;
  endedAt?: Date | null;
  priceCents?: number;
  currency?: string;
  metrics: ObservedMetric[];
  /** Original payload, kept as evidence and for re-parsing. */
  raw: unknown;
}

export interface FetchContext {
  /** Search terms, categories or IDs to query; meaning depends on the adapter. */
  queries: string[];
  /** Upper bound on items to return across all queries. */
  limit: number;
  signal?: AbortSignal;
}

/**
 * One way of getting data for one source. Source = what platform the data describes;
 * provider = who we get it from (official API, Apify, SerpApi, fixtures). See ADR-001.
 */
export interface SourceAdapter {
  source: Source;
  provider: string;
  fetch(ctx: FetchContext): AsyncIterable<FetchedItem>;
}
