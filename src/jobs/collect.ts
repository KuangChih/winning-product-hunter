/**
 * Collects live evidence for products we already track, querying each source with the
 * product's title.
 *
 *   npm run collect -- <source> [--products=20] [--countries=US,CA,GB,AU,NZ] [--dry-run]
 *
 * Sources (no API key needed):
 * - shopify_catalog: Shopify Global Catalog (official MCP)
 * - meta_ad_library: public Meta Ad Library website (ADR-006: slow, capped, stops when blocked)
 * - advertiser_stores: the advertisers' own product pages (ad landing URLs) via Global Catalog
 *   lookup: their retail price, rating and review count
 */
import "@/lib/load-env";
import { getDb } from "@/db/client";
import { forProducts } from "@/ingestion/collect-for-products";
import { createRateLimiter } from "@/ingestion/http";
import { createAdLibraryWebAdapter } from "@/ingestion/sources/meta-ad-library-web";
import {
  createShopifyCatalogAdapter,
  createStoreLookupAdapter,
} from "@/ingestion/sources/shopify-catalog";
import type { SourceAdapter } from "@/ingestion/types";
import { MARKETS } from "@/lib/markets";
import {
  COLLECT_SOURCES,
  collectForTargets,
  PROVIDER_OF,
  pickLandingPages,
  pickProducts,
  sameProductAdsOnly,
} from "@/pipeline/targets";
import { runJob } from "./run-job";

// Moved to src/pipeline/targets.ts (importing this file loads .env.local); re-exported here.
export {
  COLLECT_SOURCES,
  PROVIDER_OF,
  pickLandingPages,
  pickProducts,
  sameProductAdsOnly,
  type PickOptions,
} from "@/pipeline/targets";

export interface CollectArgs {
  source: string;
  products: number;
  countries: string[];
  dryRun: boolean;
}

const TIER_1 = MARKETS.filter((m) => m.tier === 1).map((m) => m.code);

export function createCollector(source: string, countries: string[]): SourceAdapter {
  if (source === "advertiser_stores") {
    return createStoreLookupAdapter({
      country: countries[0] ?? "US",
      profile: process.env.SHOPIFY_UCP_AGENT_PROFILE || undefined,
      wait: createRateLimiter(1500),
    });
  }
  if (source === "meta_ad_library") {
    // ADR-006: one page per query and country, 5 s apart, at most 50 pages per run.
    return createAdLibraryWebAdapter({ countries, maxRequests: 50, wait: createRateLimiter(5000) });
  }
  return createShopifyCatalogAdapter({
    countries,
    profile: process.env.SHOPIFY_UCP_AGENT_PROFILE || undefined,
    wait: createRateLimiter(1500),
  });
}

export function parseCollectArgs(argv: string[]): CollectArgs {
  const args: CollectArgs = { source: "", products: 20, countries: TIER_1, dryRun: false };
  for (const a of argv) {
    if (a === "--dry-run") args.dryRun = true;
    else if (a.startsWith("--products=")) args.products = Number(a.slice("--products=".length));
    else if (a.startsWith("--countries="))
      args.countries = a
        .slice("--countries=".length)
        .split(",")
        .map((c) => c.trim().toUpperCase())
        .filter(Boolean);
    else if (a.startsWith("--")) throw new Error(`Unknown flag ${a}`);
    else args.source = a;
  }
  if (!(COLLECT_SOURCES as readonly string[]).includes(args.source)) {
    throw new Error(`Specify a source to collect: ${COLLECT_SOURCES.join(", ")}`);
  }
  if (!Number.isInteger(args.products) || args.products <= 0) {
    throw new Error("--products must be a positive integer");
  }
  if (args.countries.length === 0) throw new Error("--countries must not be empty");
  return args;
}

async function main() {
  const args = parseCollectArgs(process.argv.slice(2));
  const db = await getDb();
  const targets =
    args.source === "advertiser_stores"
      ? await pickLandingPages(db, args.products)
      : await pickProducts(db, args.products, {
          provider: PROVIDER_OF[args.source as (typeof COLLECT_SOURCES)[number]],
        });
  if (targets.length === 0) {
    console.log("Nothing to collect: no products, or all were collected recently.");
    return;
  }

  const collector = createCollector(args.source, args.countries);
  const keep = args.source === "meta_ad_library" ? sameProductAdsOnly : undefined;

  if (args.dryRun) {
    let n = 0;
    for await (const item of forProducts(collector, targets, keep).fetch({
      queries: [],
      limit: 10_000,
    })) {
      n++;
      console.log(
        `${item.countries?.join(",")}\t${item.kind}\t${item.priceCents ?? ""} ${item.currency ?? ""}\t${item.title}`,
      );
    }
    console.log(`${n} items (dry run)`);
    return;
  }

  const result = await collectForTargets(db, collector, targets, { keep });
  console.log(
    `${collector.source}/${collector.provider}: ${result.status}, ${result.itemsFetched} items`,
  );
  if (result.status === "failed") throw new Error(result.error);
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("jobs/collect.ts")) {
  runJob(main);
}
