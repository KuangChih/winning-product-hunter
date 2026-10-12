/**
 * Which products to collect evidence for, and the attempt log that keeps products that gave
 * nothing from being picked again ahead of products never tried. No Next.js or env imports:
 * routes, the pipeline runner and CLI jobs all use it.
 */
import { and, desc, eq, gte, isNotNull, isNull, sql } from "drizzle-orm";
import type { AnyDatabase } from "@/db/client";
import { collectionAttempts, productScores, products, sourceItems } from "@/db/schema";
import { landingKey } from "@/discovery/landing";
import { forProducts, type ProductQuery } from "@/ingestion/collect-for-products";
import {
  ingestItems,
  IngestionAbortedError,
  runIngestion,
  type IngestionResult,
} from "@/ingestion/run";
import type { FetchedItem, SourceAdapter } from "@/ingestion/types";

const DAY = 86_400_000;

export const COLLECT_SOURCES = ["shopify_catalog", "meta_ad_library", "advertiser_stores"] as const;

/** Provider name each collect source writes, used to skip freshly collected products. */
export const PROVIDER_OF: Record<(typeof COLLECT_SOURCES)[number], string> = {
  shopify_catalog: "shopify_catalog",
  meta_ad_library: "ad_library_web",
  advertiser_stores: "shopify_catalog_lookup",
};

export type AttemptOutcome = "found" | "empty" | "error";

/** An attempt that found something or nothing is not repeated for this long… */
export const ATTEMPT_FRESH_DAYS = 7;
/** …and a failed one (network error, timeout) for this long. */
export const ATTEMPT_ERROR_RETRY_DAYS = 1;

export interface AttemptRow {
  productId: string;
  outcome: AttemptOutcome;
  error?: string;
}

/** Records the latest attempt per product for a provider (one statement). */
export async function recordAttempts(
  db: AnyDatabase,
  provider: string,
  rows: AttemptRow[],
  at: Date,
): Promise<void> {
  if (rows.length === 0) return;
  const unique = [...new Map(rows.map((r) => [r.productId, r])).values()];
  await db
    .insert(collectionAttempts)
    .values(
      unique.map((r) => ({
        provider,
        productId: r.productId,
        attemptedAt: at,
        outcome: r.outcome,
        error: r.error?.slice(0, 500) ?? null,
      })),
    )
    .onConflictDoUpdate({
      target: [collectionAttempts.provider, collectionAttempts.productId],
      set: {
        attemptedAt: sql`excluded.attempted_at`,
        outcome: sql`excluded.outcome`,
        error: sql`excluded.error`,
      },
    });
}

/**
 * Attempt time per product for a provider (products tried and not yet due again are left out
 * of `due`). Products never tried have no entry.
 */
async function attemptsOf(db: AnyDatabase, provider: string, now: Date, freshDays: number) {
  const rows = await db
    .select({
      productId: collectionAttempts.productId,
      attemptedAt: collectionAttempts.attemptedAt,
      outcome: collectionAttempts.outcome,
    })
    .from(collectionAttempts)
    .where(eq(collectionAttempts.provider, provider));
  const recent = new Set<string>();
  const attemptedAt = new Map<string, number>();
  for (const r of rows) {
    const days = r.outcome === "error" ? ATTEMPT_ERROR_RETRY_DAYS : freshDays;
    if (r.attemptedAt.getTime() >= now.getTime() - days * DAY) recent.add(r.productId);
    attemptedAt.set(r.productId, r.attemptedAt.getTime());
  }
  return { recent, attemptedAt };
}

/** Products with any sample (fixture) evidence: never worth real requests (real data only). */
export async function sampleProductIds(db: AnyDatabase): Promise<Set<string>> {
  const rows = await db
    .selectDistinct({ productId: sourceItems.productId })
    .from(sourceItems)
    .where(and(eq(sourceItems.provider, "fixture"), isNotNull(sourceItems.productId)));
  return new Set(rows.map((r) => r.productId!));
}

/** Never-tried products first, then the least recently tried; ties keep the given order. */
function byAttempt<T>(list: T[], idOf: (t: T) => string, attemptedAt: Map<string, number>): T[] {
  return list
    .map((item, i) => ({ item, i, t: attemptedAt.get(idOf(item)) ?? -Infinity }))
    .sort((a, b) => a.t - b.t || a.i - b.i)
    .map((x) => x.item);
}

export interface PickOptions {
  /** Skip products that already have evidence from this provider seen within `freshDays`. */
  provider?: string;
  freshDays?: number;
  now?: Date;
}

/**
 * Products to collect for: discovered products before match-created ones, then highest latest
 * score first. Products with fresh evidence from the same provider, or attempted recently with
 * it (see `recordAttempts`), are skipped so daily runs spread across the catalog; never-tried
 * products come first. Products with sample evidence are never picked.
 */
export async function pickProducts(
  db: AnyDatabase,
  limit: number,
  opts: PickOptions = {},
): Promise<ProductQuery[]> {
  const now = opts.now ?? new Date();
  const freshDays = opts.freshDays ?? ATTEMPT_FRESH_DAYS;
  const freshSince = new Date(now.getTime() - freshDays * DAY);
  const [all, scores, fresh, samples, attempts] = await Promise.all([
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
    sampleProductIds(db),
    opts.provider ? attemptsOf(db, opts.provider, now, freshDays) : null,
  ]);
  const scoreOf = new Map(scores.map((s) => [s.productId, s.score]));
  const skip = new Set([
    ...fresh.map((f) => f.productId!),
    ...samples,
    ...(attempts?.recent ?? []),
  ]);
  const ranked = all
    .filter((p) => !skip.has(p.id))
    .sort(
      (a, b) =>
        Number(!!b.landingKey) - Number(!!a.landingKey) ||
        (scoreOf.get(b.id) ?? -1) - (scoreOf.get(a.id) ?? -1),
    );
  return byAttempt(ranked, (p) => p.id, attempts?.attemptedAt ?? new Map())
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

/** The URL as given plus the same URL with "www." added or removed. */
export function hostVariants(url: string): string[] {
  try {
    const u = new URL(url);
    const other = new URL(url);
    other.hostname = u.hostname.startsWith("www.") ? u.hostname.slice(4) : `www.${u.hostname}`;
    return [u.toString(), other.toString()];
  } catch {
    return [url];
  }
}

/**
 * Products whose ads link to product pages, with those landing URLs as lookup queries
 * (advertisers' own stores). Discovered products first; never-tried before tried; freshly
 * looked-up, recently attempted and sample products skipped.
 */
export async function pickLandingPages(
  db: AnyDatabase,
  limit: number,
  opts: { freshDays?: number; now?: Date; maxUrlsPerProduct?: number } = {},
): Promise<ProductQuery[]> {
  const now = opts.now ?? new Date();
  const freshDays = opts.freshDays ?? ATTEMPT_FRESH_DAYS;
  const freshSince = new Date(now.getTime() - freshDays * DAY);
  const provider = PROVIDER_OF.advertiser_stores;
  const landingUrl = sql<string>`${sourceItems.raw}->>'landing_url'`;
  const [ads, fresh, productRows, samples, attempts] = await Promise.all([
    db
      .select({ productId: sourceItems.productId, landingUrl })
      .from(sourceItems)
      .where(
        and(
          eq(sourceItems.kind, "ad"),
          isNotNull(sourceItems.productId),
          sql`${landingUrl} is not null`,
        ),
      ),
    db
      .selectDistinct({ productId: sourceItems.productId })
      .from(sourceItems)
      .where(and(eq(sourceItems.provider, provider), gte(sourceItems.lastSeenAt, freshSince))),
    db.select({ id: products.id, landingKey: products.landingKey }).from(products),
    sampleProductIds(db),
    attemptsOf(db, provider, now, freshDays),
  ]);
  const skip = new Set([...fresh.map((f) => f.productId), ...samples, ...attempts.recent]);
  const urlsByProduct = new Map<string, Set<string>>();
  for (const ad of ads) {
    const url = landingKey(ad.landingUrl)?.url;
    if (!url || skip.has(ad.productId)) continue;
    const set = urlsByProduct.get(ad.productId!) ?? new Set<string>();
    // Each landing page is asked with and without "www." (the catalog matches the store's own
    // host exactly; measured: most ads link to the bare domain of a "www." store).
    if (set.size < 2 * (opts.maxUrlsPerProduct ?? 10))
      for (const u of hostVariants(url)) set.add(u);
    urlsByProduct.set(ad.productId!, set);
  }
  const discovered = new Set(productRows.filter((p) => p.landingKey).map((p) => p.id));
  const ranked = [...urlsByProduct.entries()].sort(
    ([a], [b]) => Number(discovered.has(b)) - Number(discovered.has(a)),
  );
  return byAttempt(ranked, ([id]) => id, attempts.attemptedAt)
    .slice(0, limit)
    .map(([productId, urls]) => ({ productId, query: [...urls] }));
}

/**
 * Runs a search-style adapter once per target product (see `forProducts`), stores the results
 * and records each product's attempt: found (something about the product was stored) / empty,
 * or error when the run failed while querying it or its results could not be stored
 * (products after it were not tried and stay due). On a caller abort the products finished
 * before it are still recorded; the one cut short is not.
 */
export async function collectForTargets(
  db: AnyDatabase,
  adapter: SourceAdapter,
  targets: ProductQuery[],
  opts: {
    keep?: (item: FetchedItem, product: ProductQuery) => boolean;
    now?: Date;
    signal?: AbortSignal;
    pipelineRunId?: number;
    /**
     * Write into this already open ingestion_runs row instead of opening and closing one (a
     * pipeline step spread over several units). Observations are then stamped `now`, so a
     * retried unit writes the same snapshots. The result's status still says how this call went.
     */
    ingestionRunId?: number;
  } = {},
): Promise<IngestionResult> {
  // Keyword-level items (e.g. a keyword's active ad count) say nothing about this product.
  const aboutProduct = (item: FetchedItem) => !!item.productId && item.kind !== "trend";
  const fetched = new Set<string>();
  const stored = new Set<string>();
  const started: string[] = [];
  const tracked = forProducts(adapter, targets, opts.keep, (p) => started.push(p.productId));
  const counting: SourceAdapter = {
    ...tracked,
    async *fetch(ctx) {
      for await (const item of tracked.fetch(ctx)) {
        if (aboutProduct(item)) fetched.add(item.productId!);
        yield item;
      }
    },
  };
  const outcome = (productId: string, failedOn?: string, error?: string): AttemptRow =>
    stored.has(productId)
      ? { productId, outcome: "found" }
      : productId === failedOn || fetched.has(productId)
        ? // Fetched but not stored (the write failed): not known to be empty.
          { productId, outcome: "error", error: error ?? "Results not stored" }
        : { productId, outcome: "empty" };

  const onStored = (item: FetchedItem) => {
    if (aboutProduct(item)) stored.add(item.productId!);
  };
  let result: IngestionResult;
  try {
    const ctx = { queries: [], limit: 10_000, signal: opts.signal };
    if (opts.ingestionRunId !== undefined) {
      const observedAt = opts.now ?? new Date();
      const r = await ingestItems(db, counting, counting.fetch(ctx), {
        now: () => observedAt,
        signal: opts.signal,
        onStored,
      });
      result = {
        runId: opts.ingestionRunId,
        status: r.error === undefined ? "succeeded" : "failed",
        itemsFetched: r.itemsFetched,
        ...(r.error === undefined
          ? {}
          : { error: r.error instanceof Error ? r.error.message : String(r.error) }),
      };
    } else {
      result = await runIngestion(db, counting, ctx, () => new Date(), {
        pipelineRunId: opts.pipelineRunId,
        onStored,
      });
    }
  } catch (err) {
    if (opts.signal?.aborted) {
      // The last product started was cut short: leave it due.
      await recordAttempts(
        db,
        adapter.provider,
        started.slice(0, -1).map((id) => outcome(id)),
        opts.now ?? new Date(),
      );
    }
    throw err instanceof IngestionAbortedError ? err.reason : err;
  }
  // The product being queried when the run failed (source or write error) was cut short.
  const failedOn = result.status === "failed" ? started.at(-1) : undefined;
  await recordAttempts(
    db,
    adapter.provider,
    started.map((id) => outcome(id, failedOn, result.error)),
    opts.now ?? new Date(),
  );
  return result;
}

/** URLs one catalog lookup request takes (Shopify `lookup_catalog`). */
export const LOOKUP_MAX_URLS = 50;

const urlsOf = (t: ProductQuery) => (Array.isArray(t.query) ? t.query : [t.query]);

/**
 * How many targets from `start` fit in one lookup request (their URLs together at most
 * `LOOKUP_MAX_URLS`; always at least one target).
 */
export function lookupGroupSize(
  targets: ProductQuery[],
  start: number,
  maxUrls = LOOKUP_MAX_URLS,
): number {
  let urls = 0;
  let n = 0;
  for (let i = start; i < targets.length; i++) {
    const add = urlsOf(targets[i]).length;
    if (n > 0 && urls + add > maxUrls) break;
    urls += add;
    n++;
  }
  return Math.max(1, n);
}

/** Store and product page of a URL ("store.example|handle:x"), the same with or without www. */
function pageKey(url: string | undefined): string | null {
  const k = landingKey(url);
  return k ? `${k.host}|${k.key}` : null;
}

/**
 * Looks up several products' landing pages in one request (store lookups): each result goes to
 * the product whose landing page it is (same store and product handle); results that match no
 * requested page are dropped. Records each product's attempt (found / empty, or error for every
 * product of a failed request).
 */
export async function collectLookups(
  db: AnyDatabase,
  adapter: SourceAdapter,
  targets: ProductQuery[],
  opts: { now?: Date; signal?: AbortSignal; ingestionRunId?: number; pipelineRunId?: number } = {},
): Promise<IngestionResult & { unmatched: number }> {
  const owner = new Map<string, string>();
  for (const t of targets) {
    for (const u of urlsOf(t)) {
      const k = pageKey(u);
      if (k && !owner.has(k)) owner.set(k, t.productId);
    }
  }
  const queries = targets.flatMap(urlsOf).slice(0, LOOKUP_MAX_URLS);
  let unmatched = 0;
  const stored = new Set<string>();
  const mapped: SourceAdapter = {
    ...adapter,
    async *fetch(ctx) {
      for await (const item of adapter.fetch({ ...ctx, queries })) {
        const productId = owner.get(pageKey(item.url) ?? "");
        if (!productId) {
          unmatched++;
          continue;
        }
        yield { ...item, productId };
      }
    },
  };
  const onStored = (item: FetchedItem) => {
    if (item.productId) stored.add(item.productId);
  };
  const ctx = { queries: [], limit: 10_000, signal: opts.signal };
  let result: IngestionResult;
  try {
    if (opts.ingestionRunId !== undefined) {
      const observedAt = opts.now ?? new Date();
      const r = await ingestItems(db, mapped, mapped.fetch(ctx), {
        now: () => observedAt,
        signal: opts.signal,
        onStored,
      });
      result = {
        runId: opts.ingestionRunId,
        status: r.error === undefined ? "succeeded" : "failed",
        itemsFetched: r.itemsFetched,
        ...(r.error === undefined
          ? {}
          : { error: r.error instanceof Error ? r.error.message : String(r.error) }),
      };
    } else {
      result = await runIngestion(db, mapped, ctx, () => new Date(), {
        pipelineRunId: opts.pipelineRunId,
        onStored,
      });
    }
  } catch (err) {
    // A caller abort leaves the whole request due (nothing recorded).
    throw err instanceof IngestionAbortedError ? err.reason : err;
  }
  const failed = result.status === "failed";
  await recordAttempts(
    db,
    adapter.provider,
    targets.map((t): AttemptRow =>
      stored.has(t.productId)
        ? { productId: t.productId, outcome: "found" }
        : failed
          ? { productId: t.productId, outcome: "error", error: result.error ?? "failed" }
          : { productId: t.productId, outcome: "empty" },
    ),
    opts.now ?? new Date(),
  );
  return { ...result, unmatched };
}
