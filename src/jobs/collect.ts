/**
 * Collects live evidence for products we already track, querying each source with the
 * product's title.
 *
 *   npm run collect -- <source> [--products=20] [--countries=US,CA,GB,AU,NZ] [--dry-run]
 *
 * Sources (no API key needed):
 * - shopify_catalog: Shopify Global Catalog (official MCP)
 * - meta_ad_library: public Meta Ad Library website (ADR-006: slow, capped, stops when blocked)
 */
import "@/lib/load-env";
import { desc } from "drizzle-orm";
import { getDb } from "@/db/client";
import { productScores, products } from "@/db/schema";
import { forProducts, type ProductQuery } from "@/ingestion/collect-for-products";
import { createRateLimiter } from "@/ingestion/http";
import { runIngestion } from "@/ingestion/run";
import { createAdLibraryWebAdapter } from "@/ingestion/sources/meta-ad-library-web";
import { createShopifyCatalogAdapter } from "@/ingestion/sources/shopify-catalog";
import type { SourceAdapter } from "@/ingestion/types";
import type { AnyDatabase } from "@/db/client";
import { MARKETS } from "@/lib/markets";
import { runJob } from "./run-job";

export interface CollectArgs {
  source: string;
  products: number;
  countries: string[];
  dryRun: boolean;
}

const TIER_1 = MARKETS.filter((m) => m.tier === 1).map((m) => m.code);

export const COLLECT_SOURCES = ["shopify_catalog", "meta_ad_library"] as const;

export function createCollector(source: string, countries: string[]): SourceAdapter {
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

/** Products to collect for: highest latest score first, then unscored products. */
export async function pickProducts(db: AnyDatabase, limit: number): Promise<ProductQuery[]> {
  const [all, scores] = await Promise.all([
    db.select({ id: products.id, title: products.title }).from(products),
    db
      .selectDistinctOn([productScores.productId], {
        productId: productScores.productId,
        score: productScores.score,
      })
      .from(productScores)
      .orderBy(productScores.productId, desc(productScores.computedAt)),
  ]);
  const scoreOf = new Map(scores.map((s) => [s.productId, s.score]));
  return all
    .sort((a, b) => (scoreOf.get(b.id) ?? -1) - (scoreOf.get(a.id) ?? -1))
    .slice(0, limit)
    .map((p) => ({ productId: p.id, query: p.title }));
}

async function main() {
  const args = parseCollectArgs(process.argv.slice(2));
  const db = await getDb();
  const targets = await pickProducts(db, args.products);
  if (targets.length === 0) {
    console.log("No products yet. Run `npm run seed` or ingest + match first.");
    return;
  }

  const adapter = forProducts(createCollector(args.source, args.countries), targets);
  const ctx = { queries: [], limit: 10_000 };

  if (args.dryRun) {
    let n = 0;
    for await (const item of adapter.fetch(ctx)) {
      n++;
      console.log(
        `${item.countries?.join(",")}\t${item.kind}\t${item.priceCents ?? ""} ${item.currency ?? ""}\t${item.title}`,
      );
    }
    console.log(`${n} items (dry run)`);
    return;
  }

  const result = await runIngestion(db, adapter, ctx);
  console.log(
    `${adapter.source}/${adapter.provider}: ${result.status}, ${result.itemsFetched} items`,
  );
  if (result.status === "failed") throw new Error(result.error);
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("jobs/collect.ts")) {
  runJob(main);
}
