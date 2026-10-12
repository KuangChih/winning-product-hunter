import type { AnyDatabase } from "@/db/client";
import type { RetryOptions, Sleep } from "@/ingestion/http";
import type { CjClient } from "@/ingestion/sources/cj";
import type { MetaApiClient } from "@/ingestion/sources/meta-ads";
import type { SourceAdapter } from "@/ingestion/types";
import type { FxRates } from "@/lib/fx";

/** Spaces requests out (see `createRateLimiter`); rejects when the signal aborts. */
export type Wait = (signal?: AbortSignal) => Promise<void>;

export interface Clock {
  now(): number;
  sleep: Sleep;
}

/**
 * What the runner needs from the outside world. `createLiveDeps` builds the real one; tests
 * inject recorded responses and a clock that does not really wait.
 */
export interface RunnerDeps {
  fetchFxRates(signal?: AbortSignal): Promise<FxRates>;
  /**
   * Ad Library adapter for one request (the runner spaces requests itself and passes no
   * `wait`). Absent: discovery and advertiser following are skipped.
   */
  adLibrary?(o: { mode: "keyword" | "advertiser"; countries: string[] }): SourceAdapter;
  /**
   * Official Meta Ad Library API client (ADR-015), one request per call. Absent (no
   * `META_ACCESS_TOKEN`): the official-API step is skipped as not configured.
   */
  metaApi?(): MetaApiClient;
  /**
   * CJ Dropshipping API client (ADR-014); its access token is cached in `db`. Absent (no
   * `CJ_API_KEY`): the CJ step is skipped as not configured.
   */
  /** `beforeRequest` paces every CJ HTTP request, the token request included (ADR-014). */
  cj?(db: AnyDatabase, o?: { beforeRequest?: (signal?: AbortSignal) => Promise<void> }): CjClient;
  shopifyCatalog?(o: { countries: string[]; wait: Wait }): SourceAdapter;
  storeLookup?(o: { country: string; wait: Wait }): SourceAdapter;
  imageRetry?: RetryOptions;
  /** Fetch for stores' own pages (redirect checks, ADR-018). Absent: those checks are skipped. */
  storePageFetch?: typeof fetch;
  /** "vercel", "github" or "local": a block of one egress does not stop the other (ADR-006 back-off). */
  egress: string;
  clock?: Clock;
  /** Fixed planning and scoring time (tests). */
  now?: Date;
}
