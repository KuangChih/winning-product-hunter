/**
 * Discovers products from the public Meta Ad Library by sweeping category keywords (ADR-007).
 *
 *   npm run discover -- [--keywords=10] [--keyword=posture corrector ...] [--countries=US,CA,GB,AU,NZ]
 *   npm run discover -- --advertisers=10   (follow today's top advertisers instead of keywords)
 *
 * Default: today's slice of 10 keywords from src/discovery/keywords.ts in the five priority
 * markets (50 pages, the per-run cap from ADR-006).
 */
import "@/lib/load-env";
import { getDb } from "@/db/client";
import { advertiserTargets, pickAdvertisers } from "@/discovery/advertisers";
import { runDiscovery } from "@/discovery/discover";
import { keywordsForDay } from "@/discovery/keywords";
import { createRateLimiter } from "@/ingestion/http";
import { createAdLibraryWebAdapter } from "@/ingestion/sources/meta-ad-library-web";
import { MARKETS } from "@/lib/markets";
import { runJob } from "./run-job";

export interface DiscoverArgs {
  keywords: string[];
  countries: string[];
  /** Follow this many advertisers instead of sweeping keywords. */
  advertisers?: number;
}

export function parseDiscoverArgs(argv: string[], today: Date = new Date()): DiscoverArgs {
  let count = 10;
  let advertisers: number | undefined;
  const explicit: string[] = [];
  let countries: string[] = MARKETS.filter((m) => m.tier === 1).map((m) => m.code);
  for (const a of argv) {
    if (a.startsWith("--keywords=")) count = Number(a.slice("--keywords=".length));
    else if (a.startsWith("--advertisers=")) {
      advertisers = Number(a.slice("--advertisers=".length));
      if (!Number.isInteger(advertisers) || advertisers <= 0) {
        throw new Error("--advertisers must be > 0");
      }
    } else if (a.startsWith("--keyword=")) explicit.push(a.slice("--keyword=".length).trim());
    else if (a.startsWith("--countries="))
      countries = a
        .slice("--countries=".length)
        .split(",")
        .map((c) => c.trim().toUpperCase())
        .filter(Boolean);
    else throw new Error(`Unknown argument ${a}`);
  }
  if (!Number.isInteger(count) || count <= 0) throw new Error("--keywords must be > 0");
  if (countries.length === 0) throw new Error("--countries must not be empty");
  return {
    keywords: explicit.length ? explicit : keywordsForDay(today, count),
    countries,
    advertisers,
  };
}

async function followAdvertisers(count: number) {
  const db = await getDb();
  const followed = await pickAdvertisers(db, count);
  for (const a of followed) {
    console.log(`follow ${a.name ?? a.pageId} (${a.country}) best score ${a.bestScore ?? "—"}`);
  }
  const adapter = createAdLibraryWebAdapter({
    mode: "advertiser",
    countries: [],
    maxRequests: 20,
    wait: createRateLimiter(5000),
  });
  const result = await runDiscovery(db, adapter, advertiserTargets(followed));
  console.log(
    `ads ${result.adsFetched}, product groups ${result.groups}, ` +
      `created ${result.productsCreated}, updated ${result.productsUpdated} (${result.ingestion.status})`,
  );
  if (result.ingestion.status === "failed") throw new Error(result.ingestion.error);
}

async function main() {
  const args = parseDiscoverArgs(process.argv.slice(2));
  if (args.advertisers) return followAdvertisers(args.advertisers);
  console.log(`keywords: ${args.keywords.join(", ")} | countries: ${args.countries.join(",")}`);
  const adapter = createAdLibraryWebAdapter({
    countries: args.countries,
    maxRequests: 50,
    wait: createRateLimiter(5000),
  });
  const result = await runDiscovery(await getDb(), adapter, args.keywords);
  console.log(
    `ads ${result.adsFetched}, product groups ${result.groups}, ` +
      `created ${result.productsCreated}, updated ${result.productsUpdated}, ` +
      `stored ${result.ingestion.itemsFetched} items (${result.ingestion.status})`,
  );
  if (result.ingestion.status === "failed") throw new Error(result.ingestion.error);
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("jobs/discover.ts")) {
  runJob(main);
}
