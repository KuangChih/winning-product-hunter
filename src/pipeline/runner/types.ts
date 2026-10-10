/**
 * Persisted shapes of the resumable pipeline runner (ADR-013). `pipeline_runs.options` and
 * `.state` hold these as JSON; every field must survive a JSON round trip (dates are ISO
 * strings, rate times epoch ms). Type-only module: the schema imports it.
 */
import type { ProductQuery } from "@/ingestion/collect-for-products";

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
  "fx" | "discover" | "advertisers" | "collect" | "stores" | "dedupe" | "match" | "score";

/** Units of work; `discover` and `advertisers` are one Ad Library request per unit. */
export type UnitName =
  | "start"
  | "discover"
  | "discover_finalize"
  | "advertisers"
  | "advertisers_finalize"
  | "collect"
  | "stores"
  | "hash"
  | "merge"
  | "match"
  | "score"
  | "finish"
  | "done";

export type SkipReason =
  /** Meta blocked this egress recently (ADR-006 back-off). */
  | "backoff"
  /** Today's Meta sweeps are used up. */
  | "daily_cap"
  /** Meta blocked a request earlier in this run. */
  | "blocked"
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

export interface DedupeStepState extends StepState {
  hashed: number;
  failed: number;
  skipped: number;
  merged: number;
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
  };
  progress: {
    keyword: number;
    advertiser: number;
    collect: number;
    stores: number;
    hashAttempted: number;
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
  rate: { adLibraryNextAt: number | null; shopifyNextAt: number | null };
  adLibrary: {
    /** Requests reserved so far (counted before each one is sent). */
    requests: number;
    blocked: { at: string; reason: string } | null;
  };
  steps: {
    fx: StepState;
    discover: StepState;
    advertisers: StepState;
    collect: CollectStepState;
    stores: CollectStepState;
    dedupe: DedupeStepState;
    match: StepState;
    score: StepState;
  };
  results: {
    /** Products created by discovery and advertiser following. */
    newProducts: number;
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
