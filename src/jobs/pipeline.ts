/**
 * Daily real-data pipeline: ECB rates → discover products (Meta Ad Library) → collect Shopify
 * Global Catalog evidence → match → score. Only real sources; sample data is `npm run seed`.
 *
 *   npm run pipeline -- [--keywords=10] [--collect=20]
 */
import "@/lib/load-env";
import { getDb } from "@/db/client";
import { keywordsForDay } from "@/discovery/keywords";
import { createRateLimiter, fetchWithRetry } from "@/ingestion/http";
import { createAdLibraryWebAdapter } from "@/ingestion/sources/meta-ad-library-web";
import { createShopifyCatalogAdapter } from "@/ingestion/sources/shopify-catalog";
import { ECB_DAILY_URL, parseEcbDaily } from "@/lib/fx";
import { MARKETS } from "@/lib/markets";
import { runPipeline } from "@/pipeline/run-pipeline";
import { runJob } from "./run-job";

function numberFlag(argv: string[], name: string, fallback: number): number {
  const raw = argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
  const n = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`--${name} must be a positive integer`);
  return n;
}

async function main() {
  const argv = process.argv.slice(2);
  const countries = MARKETS.filter((m) => m.tier === 1).map((m) => m.code);
  const keywords = keywordsForDay(new Date(), numberFlag(argv, "keywords", 10));

  const results = await runPipeline(await getDb(), {
    fetchFxRates: async () => parseEcbDaily(await (await fetchWithRetry(ECB_DAILY_URL)).text()),
    discoveryAdapter: createAdLibraryWebAdapter({
      countries,
      maxRequests: 50,
      wait: createRateLimiter(5000),
    }),
    discoveryKeywords: keywords,
    collectAdapter: createShopifyCatalogAdapter({
      countries,
      profile: process.env.SHOPIFY_UCP_AGENT_PROFILE || undefined,
      wait: createRateLimiter(1500),
    }),
    collectProducts: numberFlag(argv, "collect", 20),
  });

  for (const r of results) console.log(`${r.ok ? "ok  " : "FAIL"} ${r.step}: ${r.detail}`);
  if (results.some((r) => !r.ok)) process.exitCode = 1;
}

runJob(main);
