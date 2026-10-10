import type { RetryOptions, Sleep } from "@/ingestion/http";
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
  shopifyCatalog?(o: { countries: string[]; wait: Wait }): SourceAdapter;
  storeLookup?(o: { country: string; wait: Wait }): SourceAdapter;
  imageRetry?: RetryOptions;
  /** "vercel", "github" or "local": a block of one egress does not stop the other (ADR-006 back-off). */
  egress: string;
  clock?: Clock;
  /** Fixed planning and scoring time (tests). */
  now?: Date;
}
