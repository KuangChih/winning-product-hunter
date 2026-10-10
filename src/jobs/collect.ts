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
import { and, desc, eq, gte, isNotNull, isNull } from "drizzle-orm";
import { getDb } from "@/db/client";
import { productScores, products, sourceItems } from "@/db/schema";
import { forProducts, type ProductQuery } from "@/ingestion/collect-for-products";
import { createRateLimiter } from "@/ingestion/http";
import { runIngestion } from "@/ingestion/run";
import { createAdLibraryWebAdapter } from "@/ingestion/sources/meta-ad-library-web";
import {
  createShopifyCatalogAdapter,
  createStoreLookupAdapter,
} from "@/ingestion/sources/shopify-catalog";
import type { FetchedItem, SourceAdapter } from "@/ingestion/types";
import type { AnyDatabase } from "@/db/client";
import { landingKey } from "@/discovery/landing";
import { MARKETS } from "@/lib/markets";
import { runJob } from "./run-job";

export interface CollectArgs {
  source: string;
  products: number;
  countries: string[];
  dryRun: boolean;
}

const TIER_1 = MARKETS.filter((m) => m.tier === 1).map((m) => m.code);

export const COLLECT_SOURCES = ["shopify_catalog", "meta_ad_library", "advertiser_stores"] as const;

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

export interface PickOptions {
  /** Skip products that already have evidence from this provider seen within `freshDays`. */
  provider?: string;
  freshDays?: number;
  now?: Date;
}

/**
 * Products to collect for: discovered (real) products before sample ones, then highest latest
 * score first. Products with fresh evidence from the same provider are skipped so daily runs
 * spread across the catalog instead of re-querying the same products.
 */
export async function pickProducts(
  db: AnyDatabase,
  limit: number,
  opts: PickOptions = {},
): Promise<ProductQuery[]> {
  const now = opts.now ?? new Date();
  const freshSince = new Date(now.getTime() - (opts.freshDays ?? 7) * 86_400_000);
  const [all, scores, fresh] = await Promise.all([
    db
      .select({ id: products.id, title: products.title, landingKey: products.landingKey })
      .from(products)
      .where(isNull(products.mergedInto)),
    db
      .selectDistinctOn([productScores.productId], {
        productId: productScores.productId,
        score: productScores.score,
      })
      .from(productScores)
      .orderBy(productScores.productId, desc(productScores.computedAt)),
    opts.provider
      ? db
          .selectDistinct({ productId: sourceItems.productId })
          .from(sourceItems)
          .where(
            and(
              eq(sourceItems.provider, opts.provider),
              gte(sourceItems.lastSeenAt, freshSince),
              isNotNull(sourceItems.productId),
            ),
          )
      : Promise.resolve([]),
  ]);
  const scoreOf = new Map(scores.map((s) => [s.productId, s.score]));
  const skip = new Set(fresh.map((f) => f.productId));
  return all
    .filter((p) => !skip.has(p.id))
    .sort(
      (a, b) =>
        Number(!!b.landingKey) - Number(!!a.landingKey) ||
        (scoreOf.get(b.id) ?? -1) - (scoreOf.get(a.id) ?? -1),
    )
    .slice(0, limit)
    .map((p) => ({ productId: p.id, query: p.title, landingKey: p.landingKey }));
}

/**
 * A keyword search returns every advertiser using similar words, i.e. many different products.
 * Only ads that link to this product's own page are evidence for it; keyword-level counts are
 * kept (they describe the search, and are labeled that way).
 */
export function sameProductAdsOnly(item: FetchedItem, product: ProductQuery): boolean {
  if (item.kind !== "ad") return true;
  if (!product.landingKey) return false;
  const url = (item.raw as { landing_url?: string } | undefined)?.landing_url;
  return landingKey(url)?.key === product.landingKey;
}

/** Provider name each collect source writes, used to skip freshly collected products. */
export const PROVIDER_OF: Record<(typeof COLLECT_SOURCES)[number], string> = {
  shopify_catalog: "shopify_catalog",
  meta_ad_library: "ad_library_web",
  advertiser_stores: "shopify_catalog_lookup",
};

/**
 * Products whose ads link to product pages, with those landing URLs as lookup queries
 * (advertisers' own stores). Discovered products first; freshly looked-up products skipped.
 */
export async function pickLandingPages(
  db: AnyDatabase,
  limit: number,
  opts: { freshDays?: number; now?: Date; maxUrlsPerProduct?: number } = {},
): Promise<ProductQuery[]> {
  const now = opts.now ?? new Date();
  const freshSince = new Date(now.getTime() - (opts.freshDays ?? 7) * 86_400_000);
  const [ads, fresh, productRows] = await Promise.all([
    db
      .select({ productId: sourceItems.productId, raw: sourceItems.raw })
      .from(sourceItems)
      .where(and(eq(sourceItems.kind, "ad"), isNotNull(sourceItems.productId))),
    db
      .selectDistinct({ productId: sourceItems.productId })
      .from(sourceItems)
      .where(
        and(
          eq(sourceItems.provider, PROVIDER_OF.advertiser_stores),
          gte(sourceItems.lastSeenAt, freshSince),
        ),
      ),
    db.select({ id: products.id, landingKey: products.landingKey }).from(products),
  ]);
  const skip = new Set(fresh.map((f) => f.productId));
  const urlsByProduct = new Map<string, Set<string>>();
  for (const ad of ads) {
    const url = landingKey((ad.raw as { landing_url?: string } | null)?.landing_url)?.url;
    if (!url || skip.has(ad.productId)) continue;
    const set = urlsByProduct.get(ad.productId!) ?? new Set<string>();
    if (set.size < (opts.maxUrlsPerProduct ?? 10)) set.add(url);
    urlsByProduct.set(ad.productId!, set);
  }
  const discovered = new Set(productRows.filter((p) => p.landingKey).map((p) => p.id));
  return [...urlsByProduct.entries()]
    .sort(([a], [b]) => Number(discovered.has(b)) - Number(discovered.has(a)))
    .slice(0, limit)
    .map(([productId, urls]) => ({ productId, query: [...urls] }));
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

  const adapter = forProducts(
    createCollector(args.source, args.countries),
    targets,
    args.source === "meta_ad_library" ? sameProductAdsOnly : undefined,
  );
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
