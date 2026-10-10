import { saveFxRates } from "@/data/fx";
import type { AnyDatabase } from "@/db/client";
import { advertiserTargets, pickAdvertisers } from "@/discovery/advertisers";
import { runDiscovery } from "@/discovery/discover";
import type { RetryOptions } from "@/ingestion/http";
import { reapStaleIngestionRuns } from "@/ingestion/run";
import type { SourceAdapter } from "@/ingestion/types";
import type { FxRates } from "@/lib/fx";
import { hashProductImages, mergeDuplicateProducts } from "@/matching/merge";
import { runMatching } from "@/matching/run";
import { runScoring } from "@/scoring/run";
import { collectForTargets, pickLandingPages, pickProducts } from "./targets";

export interface PipelineDeps {
  fetchFxRates: () => Promise<FxRates>;
  discoveryAdapter: SourceAdapter;
  discoveryKeywords: string[];
  /** Ad Library adapter in advertiser mode: follows stores' other ads (Phase 4C). */
  advertiserAdsAdapter?: SourceAdapter;
  /** How many advertisers to follow per run. */
  followAdvertisers?: number;
  /** Search-style adapter run once per product (e.g. Shopify Global Catalog). */
  collectAdapter: SourceAdapter;
  collectProducts: number;
  /** Retry/fetch options for downloading product photos (tests inject a fake fetch). */
  imageRetry?: RetryOptions;
  /** Lookup adapter for advertisers' own product pages (ad landing URLs). */
  advertiserLookupAdapter?: SourceAdapter;
  now?: Date;
}

export interface StepResult {
  step: string;
  ok: boolean;
  detail: string;
}

/**
 * The daily real-data pipeline (ADR-007): FX → discover → follow advertisers → collect → advertiser stores → dedupe
 * (photo hashes) → match → score. Each step
 * runs even if an earlier one failed (a blocked source should not stop the others); failures
 * are reported in the result and in ingestion_runs.
 */
export async function runPipeline(db: AnyDatabase, deps: PipelineDeps): Promise<StepResult[]> {
  const results: StepResult[] = [];
  const step = async (name: string, fn: () => Promise<string>) => {
    try {
      results.push({ step: name, ok: true, detail: await fn() });
    } catch (err) {
      results.push({
        step: name,
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  };

  // Rows left "running" by a killed process would show as running forever on /sources.
  await reapStaleIngestionRuns(db).catch(() => 0);

  await step("fx", async () => {
    const rates = await deps.fetchFxRates();
    return `${await saveFxRates(db, rates)} rates for ${rates.date}`;
  });

  await step("discover", async () => {
    const r = await runDiscovery(db, deps.discoveryAdapter, deps.discoveryKeywords, deps.now);
    if (r.ingestion.status === "failed") throw new Error(r.ingestion.error);
    return `${r.adsFetched} ads → ${r.groups} products (${r.productsCreated} new)`;
  });

  if (deps.advertiserAdsAdapter && (deps.followAdvertisers ?? 0) > 0) {
    const adapter = deps.advertiserAdsAdapter;
    await step("follow advertisers", async () => {
      const followed = await pickAdvertisers(db, deps.followAdvertisers!, { day: deps.now });
      if (followed.length === 0) return "no advertisers with store product pages yet";
      const r = await runDiscovery(db, adapter, advertiserTargets(followed), deps.now);
      if (r.ingestion.status === "failed") throw new Error(r.ingestion.error);
      return `${followed.length} advertisers: ${r.adsFetched} ads → ${r.groups} products (${r.productsCreated} new)`;
    });
  }

  await step("collect", async () => {
    const targets = await pickProducts(db, deps.collectProducts, {
      provider: deps.collectAdapter.provider,
      now: deps.now,
    });
    if (targets.length === 0) return "nothing to collect";
    const r = await collectForTargets(db, deps.collectAdapter, targets, { now: deps.now });
    if (r.status === "failed") throw new Error(r.error);
    return `${r.itemsFetched} items for ${targets.length} products`;
  });

  if (deps.advertiserLookupAdapter) {
    const lookup = deps.advertiserLookupAdapter;
    await step("advertiser stores", async () => {
      const targets = await pickLandingPages(db, deps.collectProducts, { now: deps.now });
      if (targets.length === 0) return "nothing to look up";
      const r = await collectForTargets(db, lookup, targets, { now: deps.now });
      if (r.status === "failed") throw new Error(r.error);
      return `${r.itemsFetched} store listings for ${targets.length} products`;
    });
  }

  await step("dedupe", async () => {
    const hashed = await hashProductImages(db, { retry: deps.imageRetry });
    const { merged } = await mergeDuplicateProducts(db);
    return `${hashed.hashed} images hashed (${hashed.failed} failed), ${merged} duplicates merged`;
  });

  await step("match", async () => {
    const r = await runMatching(db);
    return `${r.itemsMatched} matched, ${r.productsCreated} products created`;
  });

  await step("score", async () => {
    const r = await runScoring(db, deps.now);
    return `${r.productsScored} products scored`;
  });

  return results;
}
