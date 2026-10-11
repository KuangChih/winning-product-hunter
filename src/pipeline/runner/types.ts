/**
 * Persisted shapes of the resumable pipeline runner (ADR-013). `pipeline_runs.options` and
 * `.state` hold these as JSON; every field must survive a JSON round trip (dates are ISO
 * strings, rate times epoch ms). Type-only module: the schema imports it.
 */
import type { ProductQuery } from "@/ingestion/collect-for-products";
import type { CjVariant } from "@/ingestion/sources/cj";

export type Trigger = "web" | "cron" | "cli";
export type RunStatus = "running" | "succeeded" | "partial" | "failed";

/** What a run was asked to do (validated by `parseRunOptions`). */
export interface RunOptions {
  /** Rotating discovery keywords to sweep (each one is a request per country). */
  keywordCount: number;
  /** The user's own keywords; replace the rotation when set. */
  keywords: string[] | null;
  /** Advertisers to follow (one request each). */
  advertisers: number;
  /** Products to collect Shopify evidence for (and advertiser stores to look up). */
  collect: number;
  /** Ad Library and Shopify Catalog countries. */
  countries: string[];
}

/** User-facing steps, in order. */
export type StepName =
  | "fx"
  | "discover"
  | "advertisers"
  | "meta_api"
  | "cj"
  | "collect"
  | "stores"
  | "dedupe"
  | "match"
  | "score";

/** Units of work; `discover` and `advertisers` are one Ad Library request per unit. */
export type UnitName =
  | "start"
  | "discover"
  | "discover_finalize"
  | "advertisers"
  | "advertisers_finalize"
  | "meta_api"
  | "meta_api_finalize"
  | "cj"
  | "cj_details"
  | "cj_finalize"
  | "cj_freight"
  | "collect"
  | "stores"
  | "hash"
  | "listing_hash"
  | "merge"
  | "match"
  | "score"
  | "finish"
  | "done";

export type SkipReason =
  /**
   * The source (Meta, the official Meta API or CJ for their steps) blocked this egress recently
   * (ADR-006 back-off).
   */
  | "backoff"
  /** Today's Meta sweeps are used up. */
  | "daily_cap"
  /** Meta blocked a request earlier in this run. */
  | "blocked"
  /** Meta served a page without ad data earlier in this run (not a block): Meta stopped. */
  | "meta_unusable"
  /** No adapter or nothing asked for (e.g. --advertisers=0). */
  | "not_configured"
  /** The run made no progress for too long and was wrapped up. */
  | "stalled"
  /** The run used up its ticks and was wrapped up. */
  | "tick_limit"
  /** The saved state was written by an incompatible version and was wrapped up. */
  | "incompatible_state";

export type StepStatus = "pending" | "running" | "done" | "failed" | "skipped";

export interface StepState {
  status: StepStatus;
  /** Result summary, e.g. "120 ads → 8 products (3 new)". */
  detail?: string;
  error?: string;
  skipReason?: SkipReason;
  done?: number;
  total?: number;
}

export interface CollectStepState extends StepState {
  /** The ingestion_runs row the step writes into (one row for all its units). */
  ingestionRunId?: number;
  items: number;
  failedProducts: number;
  /** Products failed in a row (the step stops at a few: the source keeps refusing). */
  failedInRow?: number;
  /** First few product errors. */
  errors: string[];
}

/** One CJ product list request: a keyword search, best match (ADR-014). */
export interface CjListRequest {
  /** Null only in states saved before 2026-10-11 (CJ's "trending" list): never sent. */
  keyword: string | null;
  /** New candidates this request may add, from its first `window` results. */
  take: number;
  window?: number;
}

/** A CJ product kept from the lists for a detail request (trimmed to what is stored). */
export interface CjCandidate {
  id: string;
  title: string;
  imageUrl: string | null;
  priceCents: number | null;
  listedNum: number | null;
  createAt: number | null;
  category: string | null;
  /** The keyword searches that returned it. */
  foundBy: string[];
  /** Filled by the detail request; null when it was not made or failed. */
  detail: {
    listed: number | null;
    soldOut: number | null;
    orderCount: number | null;
    totalQuantity: number | null;
    totalRefundQuantity: number | null;
    latestPaymentDate: number | null;
    /** When the product was added to CJ (epoch ms; the lists leave `createAt` empty). */
    createdAt: number | null;
    /** Its variants (ADR-017; absent in states saved before). */
    variants?: CjVariant[];
  } | null;
}

export interface CjStepState extends StepState {
  /** HTTP requests made: lists, details and the access token (each counted before it is sent). */
  requests: number;
  /** CJ's points used today, from its latest answer (null before any answer). */
  pointsUsedToday: number | null;
  /** Products returned by the lists (with repeats). */
  listed: number;
  /** List requests that failed without CJ refusing us (absent in older states). */
  listFailures?: number;
  /** Detail requests that failed (such a product is never tracked: no sales data). */
  detailFailures: number;
  /** Requests CJ refused for its per-second limit and that were sent again (absent in older states). */
  qpsRetries?: number;
  /** Shipping quotes stored / failed (ADR-017; absent in older states). */
  freightQuotes?: number;
  freightFailures?: number;
  /** CJ refused us (key, points, rate limit): no more CJ requests in this run. */
  stopped: { at: string; reason: string } | null;
}

/** One official Meta Ad Library API request: a keyword in the UK/EU target markets (ADR-015). */
export interface MetaApiRequest {
  query: string;
  countries: string[];
}

export interface MetaApiStepState extends StepState {
  /** Requests made (each counted before it is sent). */
  requests: number;
  /** Ads returned (with repeats across keywords). */
  ads: number;
  /** Requests that failed without Meta refusing us (network, Meta server error). */
  failures: number;
  /** Meta refused us (token, rate limit, request refused): no more API requests in this run. */
  stopped: { at: string; reason: string } | null;
}

export interface DedupeStepState extends StepState {
  hashed: number;
  failed: number;
  skipped: number;
  merged: number;
  /** Shopify search-result photos hashed / unusable (ADR-016; absent in older states). */
  listingsHashed?: number;
  listingsFailed?: number;
}

/** One Ad Library page request: a keyword in one country, or an advertiser target. */
export interface AdRequest {
  query: string;
  country: string;
}

export interface AdLibraryPlan {
  allowed: boolean;
  reason: null | "backoff" | "daily_cap";
  /** End of the back-off, when `reason` is "backoff". */
  until: string | null;
  /** Which of today's sweeps this is (1-based), when allowed. */
  sweep: number | null;
  /** Meta sweeps already made today before this run. */
  sweepsBefore: number;
}

export interface RunState {
  v: 1;
  /** Run-level planning time (ISO): keyword rotation, discovery observations, picks. */
  now: string;
  cursor: UnitName;
  /** Last time a unit finished (ISO); the run is wrapped up when it stops moving. */
  progressAt: string;
  plan: {
    adLibrary: AdLibraryPlan | null;
    keywords: string[] | null;
    keywordRequests: AdRequest[] | null;
    advertiserRequests: AdRequest[] | null;
    collect: ProductQuery[] | null;
    stores: ProductQuery[] | null;
    /** CJ list requests (null until planned; absent in states saved before CJ existed). */
    cj?: CjListRequest[] | null;
    /** Official Meta API requests (null until planned; absent in states saved before it). */
    metaApi?: MetaApiRequest[] | null;
  };
  progress: {
    keyword: number;
    advertiser: number;
    collect: number;
    stores: number;
    hashAttempted: number;
    /** Shopify search-result photos tried (absent in states saved before ADR-016). */
    listingHashAttempted?: number;
    /** CJ list requests and detail requests done. */
    cjList?: number;
    cjDetail?: number;
    /** Official Meta API requests done. */
    metaApi?: number;
    /** CJ shipping quote requests made (ADR-017). */
    cjFreight?: number;
  };
  /** The unit in flight, written before it starts (a retry finds it). */
  unit: {
    name: UnitName;
    key: string;
    observedAt: string;
    attempts: number;
    ingestionRunId?: number;
  } | null;
  /** Next allowed request time per rate-limited source (epoch ms). */
  rate: {
    adLibraryNextAt: number | null;
    shopifyNextAt: number | null;
    cjNextAt?: number | null;
    metaApiNextAt?: number | null;
  };
  /** CJ products kept for details, best first (absent in states saved before CJ existed). */
  cjCandidates?: CjCandidate[];
  /** Products a shipping quote was asked for in this run (never asked twice). */
  cjFreightTried?: string[];
  adLibrary: {
    /** Requests reserved so far (counted before each one is sent). */
    requests: number;
    blocked: { at: string; reason: string } | null;
    /**
     * Meta answered with a page we could not use but did not refuse us (no embedded results,
     * unreadable results): no back-off, but no more Meta requests in this run. Absent in
     * states saved before it existed.
     */
    stopped?: { at: string; reason: string } | null;
  };
  steps: {
    fx: StepState;
    discover: StepState;
    advertisers: StepState;
    /** Absent in states saved before the official Meta API step existed (see `upgradeState`). */
    meta_api: MetaApiStepState;
    /** Absent in states saved before CJ existed (see `upgradeState`). */
    cj: CjStepState;
    collect: CollectStepState;
    stores: CollectStepState;
    dedupe: DedupeStepState;
    match: StepState;
    score: StepState;
  };
  results: {
    /** Products created by discovery, advertiser following and CJ. */
    newProducts: number;
    /** Products created from CJ in this run (absent in older states). */
    cjProducts?: number;
    /** Products created from the official Meta API in this run (absent in older states). */
    metaApiProducts?: number;
    /** Products created by matching other evidence. */
    matchedProducts: number;
    /** Ads seen for the first time in this run. */
    newAds: number;
    /** Ads fetched (all, including already known ones). */
    adsFetched: number;
    productsScored: number;
  };
}

/** A fetched item as staged in `pipeline_stage` (dates as ISO strings). */
export interface StagedItem {
  externalId: string;
  kind: string;
  [key: string]: unknown;
}
